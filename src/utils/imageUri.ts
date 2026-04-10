/**
 * imageUri — resolve file:// URIs into usable formats for WebView and web.
 *
 * On native, file:// URIs cannot be loaded inside WebView origins.
 * This helper reads the file as base64 and returns a data URI.
 *
 * On web, blob/http/data URIs work directly; file:// doesn't exist.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

export async function resolveToDataUri(uri: string): Promise<string> {
  if (!uri) return '';

  if (uri.startsWith('data:') || uri.startsWith('http:') || uri.startsWith('https:') || uri.startsWith('blob:')) {
    return uri;
  }

  if (Platform.OS === 'web') {
    return uri;
  }

  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:image/jpeg;base64,${base64}`;
  } catch {
    return uri;
  }
}

export async function resolveAllToDataUri(uris: string[]): Promise<string[]> {
  return Promise.all(uris.map(resolveToDataUri));
}
