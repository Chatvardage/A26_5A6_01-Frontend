import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const requireLocal = createRequire(path.join(process.cwd(), 'package.json'));
const { obtenirConfiguration, verifierOrigine } = requireLocal('./src/infrastructure/config/ConfigurationApi.js');

afterEach(() => vi.unstubAllEnvs());

describe('Origines du serveur', () => {
  it('exige HTTPS à distance et accepte le développement local', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(verifierOrigine('https://chat.example.test/')).toBe('https://chat.example.test');
    expect(verifierOrigine('http://localhost:3000')).toBe('http://localhost:3000');
    expect(() => verifierOrigine('http://chat.example.test')).toThrow('HTTPS');
    vi.stubEnv('NODE_ENV', 'development');
    expect(verifierOrigine('http://192.168.1.5:3000')).toBe('http://192.168.1.5:3000');
  });
  it.each(['file:///etc/passwd', 'https://u:p@chat.example.test', 'https://chat.example.test/api', 'https://chat.example.test?q=1', 'https://chat.example.test#x'])('rejette une URL ambiguë : %s', (url) => {
    expect(() => verifierOrigine(url)).toThrow('origine HTTP(S)');
  });
  it('utilise la même origine HTTPS pour Socket.IO par défaut', () => {
    vi.stubEnv('CHATVARDAGE_API_URL', 'https://chat.example.test');
    vi.stubEnv('CHATVARDAGE_SOCKET_URL', '');
    expect(obtenirConfiguration()).toEqual({ baseUrlHttp: 'https://chat.example.test', baseUrlSocket: 'https://chat.example.test' });
  });
});
