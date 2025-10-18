package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"github.com/yourusername/paper-forge/internal/config"
)

const (
	SessionCookieName    = "pf_session"
	sessionKeyUser       = "auth_user"
	sessionKeyIssuedAt   = "issued_at"
	sessionKeyLastActive = "last_activity"
	sessionKeyCSRF       = "csrf_token"

	csrfHeader = "X-CSRF-Token"
)

var (
	maxSessionLifetime = 12 * time.Hour
	idleTimeout        = 30 * time.Minute
	loginWindow        = 15 * time.Minute
	lockDuration       = 10 * time.Minute
	maxLoginAttempts   = 5
)

// SessionMaxAgeSeconds はクッキーの MaxAge に利用する秒数を返します。
func SessionMaxAgeSeconds() int {
	return int(maxSessionLifetime.Seconds())
}

// ContextUserKey は、ハンドラー間でログイン済みユーザー名を共有するためのキーです。
const ContextUserKey = "auth.user"

type attemptState struct {
	count        int
	firstAttempt time.Time
	lockedUntil  time.Time
}

// Manager は認証処理と状態をまとめた構造体です。
type Manager struct {
	cfg      *config.Config
	lock     sync.Mutex
	attempts map[string]*attemptState
}

// NewManager は認証マネージャーを作成します。
func NewManager(cfg *config.Config) *Manager {
	return &Manager{
		cfg:      cfg,
		attempts: make(map[string]*attemptState),
	}
}

type loginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// Login は /auth/login のハンドラーです。
func (m *Manager) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "INVALID_INPUT",
			"message": "username と password を JSON で送ってください",
		})
		return
	}

	if err := m.ensureCredentials(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "SERVER_MISCONFIGURATION",
			"message": err.Error(),
		})
		return
	}

	ip := c.ClientIP()
	if retryAfter := m.checkLock(ip); retryAfter > 0 {
		// Retry-After は秒数またはHTTP-Date形式が推奨されているため秒数で返す
		c.Header("Retry-After", strconv.FormatInt(int64(retryAfter.Seconds()), 10))
		c.JSON(http.StatusTooManyRequests, gin.H{
			"code":    "TOO_MANY_ATTEMPTS",
			"message": "一定時間後に再度お試しください",
		})
		return
	}

	if req.Username != m.cfg.AppUsername || !m.verifyPassword(req.Password) {
		remaining := m.recordFailure(ip)
		c.JSON(http.StatusUnauthorized, gin.H{
			"code":              "INVALID_CREDENTIALS",
			"message":           "ユーザー名またはパスワードが正しくありません",
			"remainingAttempts": remaining,
		})
		return
	}

	m.resetAttempts(ip)

	token, err := generateToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "TOKEN_GENERATION_FAILED",
			"message": "CSRF トークンの生成に失敗しました",
		})
		return
	}

	session := sessions.Default(c)
	now := time.Now()
	session.Set(sessionKeyUser, m.cfg.AppUsername)
	session.Set(sessionKeyIssuedAt, now.Unix())
	session.Set(sessionKeyLastActive, now.Unix())
	session.Set(sessionKeyCSRF, token)

	if err := session.Save(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "SESSION_SAVE_FAILED",
			"message": "セッションの保存に失敗しました",
		})
		return
	}

	c.Header(csrfHeader, token)
	c.Status(http.StatusNoContent)
}

// Logout は /auth/logout のハンドラーです。
func (m *Manager) Logout(c *gin.Context) {
	session := sessions.Default(c)
	session.Clear()
	if err := session.Save(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "SESSION_SAVE_FAILED",
			"message": "セッションの削除に失敗しました",
		})
		return
	}
	c.Status(http.StatusNoContent)
}

// RequireLogin はセッションを検証するミドルウェアを返します。
func (m *Manager) RequireLogin() gin.HandlerFunc {
	return func(c *gin.Context) {
		session := sessions.Default(c)
		user, ok := session.Get(sessionKeyUser).(string)
		if !ok || user == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    "UNAUTHORIZED",
				"message": "ログインが必要です",
			})
			return
		}

		now := time.Now()
		issuedAt := readUnix(session.Get(sessionKeyIssuedAt))
		lastActive := readUnix(session.Get(sessionKeyLastActive))

		if issuedAt.IsZero() || now.Sub(issuedAt) > maxSessionLifetime {
			session.Clear()
			_ = session.Save()
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    "SESSION_EXPIRED",
				"message": "セッションの有効期限が切れました",
			})
			return
		}

		if lastActive.IsZero() || now.Sub(lastActive) > idleTimeout {
			session.Clear()
			_ = session.Save()
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    "SESSION_IDLE_TIMEOUT",
				"message": "しばらく操作がなかったため再ログインしてください",
			})
			return
		}

		session.Set(sessionKeyLastActive, now.Unix())
		_ = session.Save()
		c.Set(ContextUserKey, user)
		c.Next()
	}
}

// VerifyCSRF は X-CSRF-Token ヘッダーを検証するミドルウェアです。
func (m *Manager) VerifyCSRF() gin.HandlerFunc {
	return func(c *gin.Context) {
		if isSafeMethod(c.Request.Method) {
			c.Next()
			return
		}

		session := sessions.Default(c)
		expected, ok := session.Get(sessionKeyCSRF).(string)
		if !ok || expected == "" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"code":    "CSRF_MISSING",
				"message": "CSRF トークンが設定されていません",
			})
			return
		}

		received := c.GetHeader(csrfHeader)
		if subtle.ConstantTimeCompare([]byte(expected), []byte(received)) != 1 {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"code":    "CSRF_INVALID",
				"message": "CSRF トークンが一致しません",
			})
			return
		}

		c.Next()
	}
}

func (m *Manager) ensureCredentials() error {
	if m.cfg.AppUsername == "" {
		return errors.New("APP_USERNAME が設定されていません")
	}
	if m.cfg.AppPasswordHash == "" {
		return errors.New("APP_PASSWORD_HASH が設定されていません")
	}
	if m.cfg.SessionSecret == "" {
		return errors.New("SESSION_SECRET が設定されていません")
	}
	return nil
}

func (m *Manager) verifyPassword(password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(m.cfg.AppPasswordHash), []byte(password)) == nil
}

func (m *Manager) checkLock(ip string) time.Duration {
	m.lock.Lock()
	defer m.lock.Unlock()

	state, ok := m.attempts[ip]
	if !ok {
		return 0
	}
	now := time.Now()
	if now.After(state.lockedUntil) {
		return 0
	}
	return time.Until(state.lockedUntil)
}

func (m *Manager) recordFailure(ip string) int {
	m.lock.Lock()
	defer m.lock.Unlock()

	now := time.Now()
	state, ok := m.attempts[ip]
	if !ok || now.Sub(state.firstAttempt) > loginWindow {
		state = &attemptState{firstAttempt: now}
		m.attempts[ip] = state
	}

	state.count++
	if state.count >= maxLoginAttempts {
		state.lockedUntil = now.Add(lockDuration)
		state.count = maxLoginAttempts
	}

	remaining := maxLoginAttempts - state.count
	if remaining < 0 {
		remaining = 0
	}
	return remaining
}

func (m *Manager) resetAttempts(ip string) {
	m.lock.Lock()
	defer m.lock.Unlock()
	delete(m.attempts, ip)
}

func generateToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func readUnix(v interface{}) time.Time {
	switch t := v.(type) {
	case int64:
		return time.Unix(t, 0)
	case int:
		return time.Unix(int64(t), 0)
	case float64:
		return time.Unix(int64(t), 0)
	default:
		return time.Time{}
	}
}

func isSafeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodTrace:
		return true
	default:
		return false
	}
}
