-- Migration: Add security-related tables
-- Created: 2025-01-16
-- Purpose: Move password and logs from files to PostgreSQL

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Activity logs table
CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    username VARCHAR(50),
    action TEXT NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Login attempts tracking table (for brute-force protection)
CREATE TABLE IF NOT EXISTS login_attempts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN DEFAULT FALSE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at ON login_attempts(attempted_at DESC);

-- Insert default admin user (password: hallel0000admin)
-- This preserves the current password
INSERT INTO admin_users (username, password_hash, email)
VALUES (
    'admin',
    'pbkdf2:sha256:1000000$XF7tQsS5TLrmtXCV$b7436f615626b28e58caf08f67bc6a58daa8ab617e30a6894d047a6360c74f41',
    NULL
)
ON CONFLICT (username) DO NOTHING;

-- Add comment
COMMENT ON TABLE admin_users IS 'Stores admin user credentials';
COMMENT ON TABLE activity_logs IS 'Stores activity logs for auditing';
COMMENT ON TABLE login_attempts IS 'Tracks login attempts for brute-force protection';
