# Quick Admin Setup Guide

## 🚀 Quick Start

### Option 1: Interactive Admin Creation (Recommended)

```bash
cd bakend
npm run admin:create
```

Follow the prompts to enter:

1. Full Name
2. Email
3. Password (will be validated)

### Option 2: Seed Test Admins

```bash
cd bakend
npm run admin:seed
```

This creates 3 test admins with predefined credentials.

### Option 3: Direct Command

```bash
node scripts/createAdmin.js --name "Admin Name" --email "admin@example.com" --password "Admin@123"
```

---

## 📋 Password Requirements

✅ **Must have:**

- At least 8 characters
- At least 1 UPPERCASE letter
- At least 1 lowercase letter
- At least 1 number

✅ **Examples:**

- `Admin@123`
- `MyPassword456`
- `Secure@Pass99`

---

## 🔑 Test Credentials (After Seed)

| Name                 | Email                        | Password      |
| -------------------- | ---------------------------- | ------------- |
| Admin User           | admin@example.com            | Admin@123     |
| System Administrator | sysadmin@Hopping deals.com   | SysAdmin@456  |
| Test Admin           | test.admin@Hopping deals.com | TestAdmin@789 |

---

## 🌐 Frontend Login

1. Go to: `http://localhost:3000/admin/login`
2. Enter email and password
3. Click "Sign In"
4. Redirected to `/admin/dashboard`

---

## 📊 Database Check

View created admins:

```sql
SELECT id, fullName, email, role FROM "Users" WHERE role = 'admin';
```

---

## ⚠️ Important Notes

- Passwords are automatically hashed in database
- Store credentials securely
- Change test passwords before production
- Users can change password after login
- Each admin email must be unique
