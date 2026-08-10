/**
 * Cleanup Script - Delete Test Admin Users
 * File: bakend/scripts/deleteAdminUsers.js
 *
 * Use this if you already created admins with wrong (double-hashed) passwords
 *
 * Usage:
 * node bakend/scripts/deleteAdminUsers.js
 */

const { sequelize } = require("../config/db");
const User = require("../models/User");

const deleteAdminUsers = async () => {
  try {
    // Sync database
    await sequelize.sync();

    const adminEmails = [
      "admin@example.com",
      "sysadmin@Hopping deals.com",
      "test.admin@Hopping deals.com",
    ];

    for (const email of adminEmails) {
      const deleted = await User.destroy({
        where: { email },
      });

      if (deleted) {
        console.log(`✓ Deleted admin: ${email}`);
      } else {
        console.log(`✗ Admin not found: ${email}`);
      }
    }

    console.log("");
    console.log("✓ Cleanup completed!");
    console.log("Now run: node scripts/seedAdminUser.js");
    process.exit(0);
  } catch (error) {
    console.error("✗ Error deleting admin users:", error.message);
    process.exit(1);
  }
};

// Run deletion
deleteAdminUsers();
