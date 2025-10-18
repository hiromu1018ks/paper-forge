const textDecoder = new TextDecoder('utf-8');

export const arrayBufferToString = (buffer: ArrayBuffer): string => textDecoder.decode(buffer);

export const parseJsonFromArrayBuffer = <T = unknown>(buffer: ArrayBuffer): T => {
  const text = arrayBufferToString(buffer);
  return JSON.parse(text) as T;
};

export const parseContentDispositionFilename = (rawHeader?: string | null): string | undefined => {
  if (!rawHeader) return undefined;
  const parts = rawHeader.split(';').map((part) => part.trim());
  for (const part of parts) {
    if (part.toLowerCase().startsWith('filename*=')) {
      const value = part.substring(9).trim();
      const encoded = value.replace(/^utf-8''/i, '').replace(/^"|"$/g, '');
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    }
    if (part.toLowerCase().startsWith('filename=')) {
      const value = part.substring(9).trim().replace(/^"|"$/g, '');
      return value;
    }
  }
  return undefined;
};
