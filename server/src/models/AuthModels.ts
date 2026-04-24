import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database.js';

export const WalletBackupModel = {
  async create(userId: string, encryptedData: string, backupHash: string): Promise<string> {
    const id = uuidv4();
    
    await pool.query(
      `INSERT INTO wallet_backups (id, user_id, encrypted_data, backup_hash, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [id, userId, encryptedData, backupHash]
    );
    
    return id;
  },

  async getLatest(userId: string): Promise<any> {
    const result = await pool.query(
      `SELECT * FROM wallet_backups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    
    return result.rows[0] || null;
  },

  async getAll(userId: string): Promise<any[]> {
    const result = await pool.query(
      `SELECT id, created_at, backup_hash FROM wallet_backups WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    
    return result.rows;
  },
};

export const RecoveryCodeModel = {
  async generateCodes(userId: string, count = 10): Promise<string[]> {
    const codes = Array.from({ length: count }, () =>
      Math.random().toString(36).substring(2, 10).toUpperCase()
    );

    for (const code of codes) {
      await pool.query(
        `INSERT INTO recovery_codes (id, user_id, code, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [uuidv4(), userId, code]
      );
    }

    return codes;
  },

  async verify(userId: string, code: string): Promise<boolean> {
    const result = await pool.query(
      `SELECT id FROM recovery_codes WHERE user_id = $1 AND code = $2 AND used_at IS NULL`,
      [userId, code]
    );

    if (result.rows.length > 0) {
      await pool.query(
        `UPDATE recovery_codes SET used_at = NOW() WHERE user_id = $1 AND code = $2`,
        [userId, code]
      );
      return true;
    }

    return false;
  },

  async getUnusedCodes(userId: string): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(*) FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );
    
    return parseInt(result.rows[0].count, 10);
  },
};

export const DeviceSessionModel = {
  async create(userId: string, deviceInfo: any): Promise<string> {
    const id = uuidv4();
    const deviceHash = Buffer.from(
      JSON.stringify({
        userAgent: deviceInfo.userAgent,
        platform: deviceInfo.platform,
      })
    ).toString('hex');

    await pool.query(
      `INSERT INTO device_sessions (id, user_id, device_hash, device_info, trusted, created_at, last_activity)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [id, userId, deviceHash, JSON.stringify(deviceInfo), false]
    );

    return id;
  },

  async markTrusted(sessionId: string): Promise<void> {
    await pool.query(
      `UPDATE device_sessions SET trusted = true WHERE id = $1`,
      [sessionId]
    );
  },

  async getTrustedDevices(userId: string): Promise<any[]> {
    const result = await pool.query(
      `SELECT id, device_info, last_activity FROM device_sessions 
       WHERE user_id = $1 AND trusted = true
       ORDER BY last_activity DESC`,
      [userId]
    );

    return result.rows;
  },

  async updateLastActivity(sessionId: string): Promise<void> {
    await pool.query(
      `UPDATE device_sessions SET last_activity = NOW() WHERE id = $1`,
      [sessionId]
    );
  },

  async revoke(sessionId: string): Promise<void> {
    await pool.query(
      `DELETE FROM device_sessions WHERE id = $1`,
      [sessionId]
    );
  },

  async revokeAllUserSessions(userId: string): Promise<void> {
    await pool.query(
      `DELETE FROM device_sessions WHERE user_id = $1`,
      [userId]
    );
  },
};

export const OAuthProviderModel = {
  async linkProvider(userId: string, provider: string, providerId: string, email: string): Promise<void> {
    await pool.query(
      `INSERT INTO oauth_providers (id, user_id, provider, provider_id, provider_email, linked_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (provider, provider_id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           provider_email = EXCLUDED.provider_email,
           linked_at = NOW()`,
      [uuidv4(), userId, provider, providerId, email]
    );
  },

  async findByProvider(provider: string, providerId: string): Promise<any> {
    const result = await pool.query(
      `SELECT u.* FROM users u
       JOIN oauth_providers op ON u.id = op.user_id
       WHERE op.provider = $1 AND op.provider_id = $2`,
      [provider, providerId]
    );

    return result.rows[0] || null;
  },

  async getLinkedProviders(userId: string): Promise<string[]> {
    const result = await pool.query(
      `SELECT DISTINCT provider FROM oauth_providers WHERE user_id = $1`,
      [userId]
    );

    return result.rows.map((row: any) => row.provider);
  },
};

export const MFASettingsModel = {
  async create(userId: string): Promise<void> {
    await pool.query(
      `INSERT INTO mfa_settings (id, user_id, enabled_methods, required_methods)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO NOTHING`,
      [uuidv4(), userId, [], []]
    );
  },

  async updateEnabledMethods(userId: string, methods: string[]): Promise<void> {
    await pool.query(
      `UPDATE mfa_settings SET enabled_methods = $1, updated_at = NOW() WHERE user_id = $2`,
      [methods, userId]
    );
  },

  async updateRequiredMethods(userId: string, methods: string[]): Promise<void> {
    await pool.query(
      `UPDATE mfa_settings SET required_methods = $1, updated_at = NOW() WHERE user_id = $2`,
      [methods, userId]
    );
  },

  async getSettings(userId: string): Promise<any> {
    const result = await pool.query(
      `SELECT * FROM mfa_settings WHERE user_id = $1`,
      [userId]
    );

    return result.rows[0] || null;
  },

  async addEnabledMethod(userId: string, method: string): Promise<void> {
    await MFASettingsModel.create(userId);
    const settings = await MFASettingsModel.getSettings(userId);
    const enabledMethods = Array.isArray(settings?.enabled_methods) ? settings.enabled_methods : [];

    if (!enabledMethods.includes(method)) {
      await MFASettingsModel.updateEnabledMethods(userId, [...enabledMethods, method]);
    }
  },
};
