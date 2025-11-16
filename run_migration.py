#!/usr/bin/env python3
"""
Database Migration Runner
Executes SQL migration files in the migrations/ directory
"""
import os
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

def run_migration():
    """Run all migration files"""
    DATABASE_URL = os.environ.get('POSTGRES_URL')
    if not DATABASE_URL:
        print("❌ POSTGRES_URL environment variable not set")
        return False

    migration_file = 'migrations/001_add_security_tables.sql'

    print(f"🔄 Running migration: {migration_file}")

    try:
        # Connect to database
        conn = psycopg2.connect(DATABASE_URL)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()

        # Read and execute migration file
        with open(migration_file, 'r') as f:
            sql = f.read()

        cur.execute(sql)

        print(f"✅ Migration completed successfully: {migration_file}")

        # Verify tables were created
        cur.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name IN ('admin_users', 'activity_logs', 'login_attempts')
            ORDER BY table_name
        """)
        tables = cur.fetchall()

        print("\n📊 Created tables:")
        for table in tables:
            print(f"   - {table[0]}")

        # Check default admin user
        cur.execute("SELECT username, created_at FROM admin_users WHERE username = 'admin'")
        admin = cur.fetchone()
        if admin:
            print(f"\n👤 Default admin user: {admin[0]} (created: {admin[1]})")

        cur.close()
        conn.close()

        return True

    except Exception as e:
        print(f"❌ Migration failed: {str(e)}")
        return False

if __name__ == '__main__':
    print("=" * 60)
    print("🔐 HALLEL Security Migration - Phase 1")
    print("=" * 60)
    print()

    success = run_migration()

    print()
    if success:
        print("✅ All migrations completed successfully!")
        print()
        print("📝 Next steps:")
        print("   1. Deploy the updated app.py")
        print("   2. Verify login works with existing password")
        print("   3. Remove password.txt and activity.log from Git")
    else:
        print("❌ Migration failed. Please check the error above.")
    print()
    print("=" * 60)
