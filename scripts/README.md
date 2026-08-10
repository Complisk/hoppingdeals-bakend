# Admin User Management Scripts

This directory contains scripts for managing admin users in the backend.

## Available Scripts

### 1. Create Admin (Interactive)

**File:** `createAdmin.js`

Interactive script to create a new admin user with validation.

#### Usage:

**Interactive mode (prompted input):**

```bash
npm run admin:create
```

**Direct mode (with arguments):**

```bash
node scripts/createAdmin.js --name "Admin Name" --email "admin@example.com" --password "SecurePass123"
```

#### Features:

- ✅ Interactive CLI with color-coded output
- ✅ Email validation
- ✅ Password strength validation
  - Minimum 8 characters
  - At least one uppercase letter
  - At least one lowercase letter
  - At least one number
- ✅ Duplicate email check
- ✅ Automatic password hashing (handled by User model)
- ✅ Displays credentials after creation

#### Example Output:

```
Connecting to database...
✓ Database connected

╔════════════════════════════════════════╗
║     Create New Admin User              ║
╚════════════════════════════════════════╝

Full Name: John Admin
Email: john.admin@example.com
Password: SecurePass123

Checking if admin already exists...
Creating admin user...


╔════════════════════════════════════════╗
║   Admin User Created Successfully!    ║
╚════════════════════════════════════════╝

Admin Details:
  ID:       a1b2c3d4-e5f6-7890-abcd-ef1234567890
  Name:     John Admin
  Email:    john.admin@example.com
  Role:     admin
  Status:   Active

Login Credentials:
  Email:    john.admin@example.com
  Password: SecurePass123

⚠️  Note: Save these credentials in a secure location
⚠️  Users can change their password after first login
```

### 2. Seed Admin Users

**File:** `seedAdminUser.js`

Bulk script to seed multiple test admin users into the database.

#### Usage:

```bash
npm run admin:seed
```

Or directly:

```bash
node scripts/seedAdminUser.js
```

#### Default Test Admins:

1. **Admin User**
   - Email: `admin@example.com`
   - Password: `Admin@123`

2. **System Administrator**
   - Email: `sysadmin@Hopping deals.com`
   - Password: `SysAdmin@456`

3. **Test Admin**
   - Email: `test.admin@Hopping deals.com`
   - Password: `TestAdmin@789`

#### Features:

- ✅ Skips if admin already exists
- ✅ Creates multiple test users at once
- ✅ Shows credentials for each new admin
- ✅ Useful for development and testing

#### Example Output:

```
✓ Admin user seeding completed!
✓ Admin created successfully:
  Email: admin@example.com
  Name: Admin User
  Role: admin
  Password: Admin@123 (use this to login)

✓ Admin already exists: sysadmin@Hopping deals.com
✓ Admin created successfully:
  Email: test.admin@Hopping deals.com
  Name: Test Admin
  Role: admin
  Password: TestAdmin@789 (use this to login)
```

## Password Requirements

All admin passwords must meet the following criteria:

- **Minimum Length:** 8 characters
- **Uppercase:** At least one A-Z character
- **Lowercase:** At least one a-z character
- **Number:** At least one 0-9 digit

### Examples of Valid Passwords:

- ✅ `Admin@123`
- ✅ `SecurePass456`
- ✅ `MyP@ssw0rd`

### Examples of Invalid Passwords:

- ❌ `password` (no uppercase, no number)
- ❌ `PASSWORD123` (no lowercase)
- ❌ `Pass123` (too short)
- ❌ `admin@123` (no uppercase)

## Database Considerations

### Before Running Scripts:

1. **Ensure Database is Running:**

   ```bash
   # PostgreSQL (or your database)
   # Make sure your database service is running
   ```

2. **Check Environment Variables:**
   - Verify `.env` file has correct database credentials
   - Example `.env`:
     ```
     DATABASE_URL=postgresql://user:password@localhost:5432/Hopping deals_db
     ```

3. **Run Database Migrations (if needed):**
   ```bash
   # Make sure User table exists
   npm run dev  # This will auto-sync with Sequelize
   ```

### After Running Scripts:

1. **Verify Admin Creation:**

   ```bash
   # Check database
   SELECT * FROM "Users" WHERE role = 'admin';
   ```

2. **Test Login:**
   - Go to `/admin/login` in the frontend
   - Use the email and password from the script output
   - Verify successful login and redirect to `/admin/dashboard`

## Troubleshooting

### Script Fails to Connect to Database

```
Error: Error connecting to database
```

**Solution:**

- Check `.env` file DATABASE_URL is correct
- Verify database service is running
- Ensure database name exists

### Email Already Exists

```
✗ An account with email "admin@example.com" already exists
```

**Solution:**

- Use a different email address
- Or delete the existing admin and recreate it
- Check database: `SELECT * FROM "Users" WHERE email = 'admin@example.com';`

### Password Validation Fails

```
✗ Password must contain at least one uppercase letter
```

**Solution:**

- Follow password requirements above
- Use a password like `Admin@123`

### Node Version Mismatch

```
Error: Module not found
```

**Solution:**

- Check Node version: `node --version`
- Project requires Node 24.x
- Use nvm: `nvm use 24`

## Quick Start Guide

### For Development:

```bash
# 1. Seed multiple test admins
npm run admin:seed

# 2. Login with any of the test credentials
# Email: admin@example.com
# Password: Admin@123
```

### For Production:

```bash
# 1. Create a single secure admin user
npm run admin:create

# 2. Follow the prompts and choose a strong password

# 3. Login with the provided credentials

# 4. Change password from admin profile (recommended)
```

## Integration with Frontend

After creating an admin user:

1. **Admin Login Page:** `/admin/login`

   ```
   Email: [email from script]
   Password: [password from script]
   ```

2. **Redux Auth State:** After login, the admin data is stored:

   ```javascript
   // localStorage
   localStorage.userToken = "jwt_token";
   localStorage.user = {
     id: "...",
     fullName: "Admin Name",
     email: "admin@example.com",
     role: "admin",
   };
   localStorage.accountType = "user";
   ```

3. **Protected Routes:** Access `/admin/*` routes only with valid admin credentials

## API Endpoints

The admin login uses the standard auth endpoint:

**POST** `/api/auth/login`

```json
{
  "email": "admin@example.com",
  "password": "Admin@123",
  "type": "admin"
}
```

**Response:**

```json
{
  "id": "...",
  "email": "admin@example.com",
  "fullName": "Admin Name",
  "role": "admin",
  "token": "jwt_token..."
}
```

## Security Notes

⚠️ **Important:**

- Store admin credentials securely
- Never commit passwords to version control
- Change default test passwords in production
- Use strong, unique passwords for each admin
- Implement password change on first login (recommended)
- Rotate admin credentials periodically
- Use HTTPS in production

## Support

For issues or questions:

1. Check the troubleshooting section above
2. Verify all environment variables are correct
3. Ensure database is accessible and running
4. Check backend logs for detailed error messages
