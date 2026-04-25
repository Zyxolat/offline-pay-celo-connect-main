import pool from '../config/database';

export const AuthSessionModel = {
  async create(
    sessionToken: string,
    options: {
      userId?: string;
      isAdmin?: boolean;
      expiresAt?: Date;
      sessionType?: string;
    } = {}
  ) {
    const expiresAt =
      options.expiresAt || new Date(Date.now() + 1000 * 60 * 60);

    await pool.query(
      `
        INSERT INTO auth_sessions (user_id, session_token, session_type, is_admin, expires_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        options.userId || null,
        sessionToken,
        options.sessionType || (options.isAdmin ? 'admin' : 'user'),
        Boolean(options.isAdmin),
        expiresAt,
      ]
    );
  },

  async touch(sessionToken: string) {
    await pool.query(
      `
        UPDATE auth_sessions
        SET last_seen_at = NOW()
        WHERE session_token = $1
      `,
      [sessionToken]
    );
  },

  async findActiveSession(sessionToken: string) {
    const result = await pool.query(
      `
        SELECT *
        FROM auth_sessions
        WHERE session_token = $1
          AND expires_at > NOW()
        LIMIT 1
      `,
      [sessionToken]
    );

    return result.rows[0] || null;
  },

  async revokeUserSessions(userId: string) {
    await pool.query('DELETE FROM auth_sessions WHERE user_id = $1 AND is_admin = FALSE', [userId]);
  },

  async revoke(sessionToken: string) {
    await pool.query('DELETE FROM auth_sessions WHERE session_token = $1', [sessionToken]);
  },
};
