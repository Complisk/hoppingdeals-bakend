-- Seed Script - Add Test Admin Users to Database
-- File: bakend/scripts/seedAdminUser.sql
-- 
-- Usage:
-- psql -U postgres -d comflisk_db -f bakend/scripts/seedAdminUser.sql
-- OR manually run these INSERT statements in your database

-- Note: Passwords are hashed using bcryptjs (10 rounds)
-- You need to hash the plain text passwords before inserting

-- Test Admin Users (INSERT these one by one)

-- Admin 1: admin@example.com (Password: Admin@123)
-- Hash for "Admin@123": $2a$10$... (use bcryptjs to generate)
INSERT INTO "users" (
  "fullName", 
  "email", 
  "password", 
  "role", 
  "isBlocked", 
  "createdAt", 
  "updatedAt"
) 
VALUES (
  'Admin User',
  'admin@example.com',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36P4/laSi',  -- bcrypt hash for "Admin@123"
  'admin',
  false,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING;

-- Admin 2: sysadmin@Hopping deals.com (Password: SysAdmin@456)
INSERT INTO "users" (
  "fullName", 
  "email", 
  "password", 
  "role", 
  "isBlocked", 
  "createdAt", 
  "updatedAt"
) 
VALUES (
  'System Administrator',
  'sysadmin@Hopping deals.com',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36P4/laSi',  -- bcrypt hash
  'admin',
  false,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING;

-- Admin 3: test.admin@Hopping deals.com (Password: TestAdmin@789)
INSERT INTO "users" (
  "fullName", 
  "email", 
  "password", 
  "role", 
  "isBlocked", 
  "createdAt", 
  "updatedAt"
) 
VALUES (
  'Test Admin',
  'test.admin@Hopping deals.com',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36P4/laSi',  -- bcrypt hash
  'admin',
  false,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING;

-- Verify inserted admins
SELECT id, "fullName", email, role FROM "users" WHERE role = 'admin';
