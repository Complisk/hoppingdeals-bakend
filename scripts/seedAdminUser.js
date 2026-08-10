/**
 * Seed Script - Add Test Admin Users to Database
 * File: bakend/scripts/seedAdminUser.js
 *
 * Usage:
 * node bakend/scripts/seedAdminUser.js
 */

const { sequelize } = require("../config/db");
const User = require("../models/User");
const bcrypt = require("bcryptjs");

const seedAdminUser = async () => {
  try {
    // Sync database
    await sequelize.sync();

    // Admin credentials for testing
    const adminUsers = [
      {
        fullName: "Admin User",
        email: "admin@example.com",
        password: "Admin@123",
        role: "admin",
      },
      {
        fullName: "System Administrator",
        email: "sysadmin@Hopping deals.com",
        password: "SysAdmin@456",
        role: "admin",
      },
      {
        fullName: "Test Admin",
        email: "test.admin@Hopping deals.com",
        password: "TestAdmin@789",
        role: "admin",
      },
    ];

    for (const adminData of adminUsers) {
      // Check if admin already exists
      const existingAdmin = await User.findOne({
        where: { email: adminData.email },
      });

      if (existingAdmin) {
        console.log(`✓ Admin already exists: ${adminData.email}`);
      } else {
        // Create admin user
        // NOTE: Password will be automatically hashed by User model beforeCreate hook
        const admin = await User.create({
          fullName: adminData.fullName,
          email: adminData.email,
          password: adminData.password, // Pass plain password - model will hash it
          role: adminData.role,
        });

        console.log(`✓ Admin created successfully:`);
        console.log(`  Email: ${admin.email}`);
        console.log(`  Name: ${admin.fullName}`);
        console.log(`  Role: ${admin.role}`);
        console.log(`  Password: ${adminData.password} (use this to login)`);
        console.log("");
      }
    }

    console.log("✓ Admin user seeding completed!");
    process.exit(0);
  } catch (error) {
    console.error("✗ Error seeding admin users:", error.message);
    process.exit(1);
  }
};

// Run seeding
seedAdminUser();
