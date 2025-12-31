// src/database/sync.ts
import "dotenv/config";
import { sequelize } from "../models";
import { db } from "./DBService";

async function syncDatabase() {
  try {
    console.log("🚀 Starting database sync process...");

    // 1) Init writer/reader connections (your DBService)
    await db.init();
    console.log("✅ Database service initialized");

    // 2) Sync tables
    const isProduction = process.env.NODE_ENV === "production";

    /**
     * ✅ IMPORTANT:
     * - In DEV: alter=true (keeps schema in sync automatically)
     * - In PROD: alter=false by default (safe)
     * - If you WANT schema changes in prod, set DB_SYNC_ALTER=true
     */
    const allowAlter = process.env.DB_SYNC_ALTER === "true";
    const alter = isProduction ? allowAlter : true;

    console.log("🔧 Sequelize.sync config:", {
      NODE_ENV: process.env.NODE_ENV,
      isProduction,
      force: false,
      alter,
    });

    await sequelize.sync({ force: false, alter });
    console.log("✅ Model sync complete");

    // 3) Seed initial RBAC data
    await seedInitialData();
    console.log("✅ Seeding complete");

    console.log("🎉 Database sync completed successfully!");
  } catch (error) {
    console.error("❌ Database sync failed:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message);
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

async function seedInitialData() {
  const transaction = await sequelize.transaction();

  try {
    console.log("🌱 Starting initial data seeding...");

    // --- ROLE: ADMIN (UUID) -------------------------------------------
    const ADMIN_ROLE_ID = "11111111-1111-1111-1111-111111111111";
    const VIEWER_ROLE_ID = "22222222-2222-2222-2222-222222222222";

    // Enable UUID extension if not exists (for PostgreSQL)
    await sequelize.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`, {
      transaction,
    });

    // (Optional) pgcrypto for gen_random_uuid if you ever use it
    await sequelize.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`, {
      transaction,
    });

    // Create or update Admin role
    await sequelize.query(
      `
        INSERT INTO public.roles (id, name, level, created_at, updated_at)
        VALUES (:id, :name, :level, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            level = EXCLUDED.level,
            updated_at = NOW()
        RETURNING id;
      `,
      {
        replacements: {
          id: ADMIN_ROLE_ID,
          name: "Admin",
          level: 1,
        },
        transaction,
      }
    );

    console.log(`✅ Admin role ensured (ID: ${ADMIN_ROLE_ID})`);

    // --- ALL MODULE PERMISSIONS ------------------------------------
    const PERMISSIONS = [
      // ================== DASHBOARD ==================
      {
        id: "00000000-0001-1111-1111-111111111111",
        name: "dashboard.view",
        description: "can access dashboard",
      },

      // ================== PROFILE ==================
      {
        id: "00000000-0002-1111-1111-111111111111",
        name: "profile.view",
        description: "can view profile",
      },

      // ================== MARKET MODULE ==================
      {
        id: "11111111-0001-1111-1111-111111111111",
        name: "market.view",
        description: "can access market module",
      },
      {
        id: "11111111-0002-1111-1111-111111111111",
        name: "market.alldata.view",
        description: "can view all market data",
      },
      {
        id: "11111111-0003-1111-1111-111111111111",
        name: "market.converteddata.view",
        description: "can view converted data",
      },
      {
        id: "11111111-0004-1111-1111-111111111111",
        name: "market.pendingdata.view",
        description: "can view pending data",
      },

      // ================== PROCUREMENT/VENDOR MODULE ==================
      {
        id: "22222222-0001-1111-1111-111111111111",
        name: "procurement.view",
        description: "can access procurement module",
      },
      {
        id: "22222222-0002-1111-1111-111111111111",
        name: "procurement.dashboard.view",
        description: "can view procurement dashboard",
      },
      {
        id: "22222222-0003-1111-1111-111111111111",
        name: "procurement.boq.view",
        description: "can view BOQ",
      },
      {
        id: "22222222-0004-1111-1111-111111111111",
        name: "procurement.boq.manage",
        description: "can manage BOQ",
      },
      {
        id: "22222222-0005-1111-1111-111111111111",
        name: "procurement.vendor.view",
        description: "can view all vendors",
      },
      {
        id: "22222222-0006-1111-1111-111111111111",
        name: "procurement.vendor.manage",
        description: "can manage vendors",
      },
      {
        id: "22222222-0007-1111-1111-111111111111",
        name: "procurement.purchaseorder.view",
        description: "can view purchase orders",
      },
      {
        id: "22222222-0008-1111-1111-111111111111",
        name: "procurement.purchaseorder.manage",
        description: "can manage purchase orders",
      },
      {
        id: "22222222-0009-1111-1111-111111111111",
        name: "procurement.orderbill.view",
        description: "can view order bills",
      },
      {
        id: "22222222-0010-1111-1111-111111111111",
        name: "procurement.orderbill.manage",
        description: "can manage order bills",
      },
      {
        id: "22222222-0011-1111-1111-111111111111",
        name: "procurement.payment.view",
        description: "can view payments",
      },
      {
        id: "22222222-0012-1111-1111-111111111111",
        name: "procurement.payment.manage",
        description: "can manage payments",
      },
      {
        id: "22222222-0013-1111-1111-111111111111",
        name: "procurement.ledger.view",
        description: "can view vendor ledger",
      },

      // ================== SALES MODULE ==================
      {
        id: "33333333-0001-1111-1111-111111111111",
        name: "sales.view",
        description: "can access sales module",
      },
      {
        id: "33333333-0002-1111-1111-111111111111",
        name: "sales.dashboard.view",
        description: "can view sales dashboard",
      },
      {
        id: "33333333-0003-1111-1111-111111111111",
        name: "sales.clients.view",
        description: "can view clients",
      },
      {
        id: "33333333-0004-1111-1111-111111111111",
        name: "sales.clients.manage",
        description: "can manage clients",
      },
      {
        id: "33333333-0005-1111-1111-111111111111",
        name: "sales.estimate.view",
        description: "can view estimates",
      },
      {
        id: "33333333-0006-1111-1111-111111111111",
        name: "sales.estimate.manage",
        description: "can manage estimates",
      },

      // ================== AMC MODULE ==================
      {
        id: "33333333-0007-1111-1111-111111111111",
        name: "amc.view",
        description: "can access AMC module",
      },
      {
        id: "33333333-0008-1111-1111-111111111111",
        name: "amc.estimate.view",
        description: "can view AMC estimates",
      },
      {
        id: "33333333-0009-1111-1111-111111111111",
        name: "amc.estimate.manage",
        description: "can manage AMC estimates",
      },
      {
        id: "33333333-0010-1111-1111-111111111111",
        name: "amc.all.view",
        description: "can view all AMC",
      },
      {
        id: "33333333-0011-1111-1111-111111111111",
        name: "amc.upcomingservice.view",
        description: "can view all upcoming services",
      },
      {
        id: "33333333-0012-1111-1111-111111111111",
        name: "amc.package.view",
        description: "can view AMC packages",
      },
      {
        id: "33333333-0013-1111-1111-111111111111",
        name: "amc.package.manage",
        description: "can manage AMC packages",
      },
      {
        id: "33333333-0014-1111-1111-111111111111",
        name: "amc.billingrequest.view",
        description: "can view billing requests",
      },
      {
        id: "33333333-0015-1111-1111-111111111111",
        name: "amc.billingrequest.manage",
        description: "can manage billing requests",
      },
      {
        id: "33333333-0016-1111-1111-111111111111",
        name: "amc.overview.view",
        description: "can view AMC overview",
      },
      {
        id: "33333333-0017-1111-1111-111111111111",
        name: "amc.upcomingservices.view",
        description: "can view upcoming services",
      },

      // ================== CUSTOMER SUPPORT MODULE ==================
      {
        id: "33333333-0018-1111-1111-111111111111",
        name: "customersupport.view",
        description: "can access customer support",
      },
      {
        id: "33333333-0019-1111-1111-111111111111",
        name: "support.hvac.view",
        description: "can view HVAC tickets",
      },
      {
        id: "33333333-0020-1111-1111-111111111111",
        name: "support.hvac.manage",
        description: "can manage HVAC tickets",
      },
      {
        id: "33333333-0021-1111-1111-111111111111",
        name: "support.aircondition.view",
        description: "can view air condition tickets",
      },
      {
        id: "33333333-0022-1111-1111-111111111111",
        name: "support.aircondition.manage",
        description: "can manage air condition tickets",
      },

      // ================== ACCOUNTS MODULE ==================
      {
        id: "44444444-0001-1111-1111-111111111111",
        name: "accounts.view",
        description: "can access accounts module",
      },
      {
        id: "44444444-0002-1111-1111-111111111111",
        name: "accounts.dashboard.view",
        description: "can view accounts dashboard",
      },
      {
        id: "44444444-0003-1111-1111-111111111111",
        name: "accounts.banking.view",
        description: "can view banking",
      },
      {
        id: "44444444-0004-1111-1111-111111111111",
        name: "accounts.banking.manage",
        description: "can manage banking",
      },
      {
        id: "44444444-0005-1111-1111-111111111111",
        name: "accounts.allpi.view",
        description: "can view all PI",
      },
      {
        id: "44444444-0006-1111-1111-111111111111",
        name: "accounts.taxinvoice.view",
        description: "can view tax invoices",
      },
      {
        id: "44444444-0007-1111-1111-111111111111",
        name: "accounts.taxinvoice.manage",
        description: "can manage tax invoices",
      },
      {
        id: "44444444-0008-1111-1111-111111111111",
        name: "accounts.receivedpayment.view",
        description: "can view received payments",
      },
      {
        id: "44444444-0009-1111-1111-111111111111",
        name: "accounts.receivedpayment.manage",
        description: "can manage received payments",
      },
      {
        id: "44444444-0010-1111-1111-111111111111",
        name: "accounts.partialpayment.view",
        description: "can view partial payments",
      },
      {
        id: "44444444-0011-1111-1111-111111111111",
        name: "accounts.partialpayment.manage",
        description: "can manage partial payments",
      },
      {
        id: "44444444-0012-1111-1111-111111111111",
        name: "accounts.payments.clearance",
        description: "can clear payments",
      },
      {
        id: "44444444-0013-1111-1111-111111111111",
        name: "accounts.ledger.view",
        description: "can view account ledger",
      },

      // ================== GST & TAX SECTION ==================
      {
        id: "44444444-0014-1111-1111-111111111111",
        name: "accounts.gst.view",
        description: "can access GST section",
      },
      {
        id: "44444444-0015-1111-1111-111111111111",
        name: "accounts.gst.manage",
        description: "can manage GST",
      },
      {
        id: "44444444-0016-1111-1111-111111111111",
        name: "accounts.tds.view",
        description: "can access TDS section",
      },
      {
        id: "44444444-0017-1111-1111-111111111111",
        name: "accounts.tds.manage",
        description: "can manage TDS",
      },

      // ================== LOAN SECTION ==================
      {
        id: "44444444-0018-1111-1111-111111111111",
        name: "accounts.loan.view",
        description: "can access loan section",
      },
      {
        id: "44444444-0019-1111-1111-111111111111",
        name: "accounts.loan.accounts.view",
        description: "can view loan accounts",
      },
      {
        id: "44444444-0020-1111-1111-111111111111",
        name: "accounts.loan.taken.view",
        description: "can view all loans taken",
      },
      {
        id: "44444444-0021-1111-1111-111111111111",
        name: "accounts.loan.given.view",
        description: "can view all loans given",
      },
      {
        id: "44444444-0022-1111-1111-111111111111",
        name: "accounts.loan.manage",
        description: "can manage loans",
      },

      // ================== HR MODULE ==================
      {
        id: "55555555-0001-1111-1111-111111111111",
        name: "hr.view",
        description: "can access HR module",
      },
      {
        id: "55555555-0002-1111-1111-111111111111",
        name: "hr.employee.view",
        description: "can view employees",
      },
      {
        id: "55555555-0003-1111-1111-111111111111",
        name: "hr.employee.manage",
        description: "can manage employees",
      },

      // ================== EXPENSE MODULE ==================
      {
        id: "66666666-0001-1111-1111-111111111111",
        name: "expense.view",
        description: "can access expense module",
      },
      {
        id: "66666666-0002-1111-1111-111111111111",
        name: "expense.manage",
        description: "can manage expenses",
      },

      // ================== USER MANAGEMENT MODULE ==================
      {
        id: "77777777-0001-1111-1111-111111111111",
        name: "usermanagement.view",
        description: "can view user management",
      },
      {
        id: "77777777-0002-1111-1111-111111111111",
        name: "usermanagement.manage",
        description: "can manage users",
      },
      {
        id: "77777777-0003-1111-1111-111111111111",
        name: "useractivity.view",
        description: "can view user activities",
      },
      {
        id: "77777777-0004-1111-1111-111111111111",
        name: "useractivity.audit",
        description: "can audit user activities",
      },

      // ================== SYSTEM MANAGEMENT ==================
      {
        id: "88888888-0001-1111-1111-111111111111",
        name: "system.masterroles.view",
        description: "can view master roles",
      },
      {
        id: "88888888-0002-1111-1111-111111111111",
        name: "system.masterroles.manage",
        description: "can manage master roles",
      },
      {
        id: "88888888-0003-1111-1111-111111111111",
        name: "system.settings.view",
        description: "can view settings",
      },
      {
        id: "88888888-0004-1111-1111-111111111111",
        name: "system.settings.manage",
        description: "can manage settings",
      },
      {
        id: "88888888-0005-1111-1111-111111111111",
        name: "system.systemuser.view",
        description: "can view system users",
      },
      {
        id: "88888888-0006-1111-1111-111111111111",
        name: "system.systemuser.add",
        description: "can add system users",
      },
      {
        id: "88888888-0007-1111-1111-111111111111",
        name: "system.systemuser.edit",
        description: "can edit system users",
      },
      {
        id: "88888888-0008-1111-1111-111111111111",
        name: "system.systemuser.delete",
        description: "can delete system users",
      },
      {
        id: "88888888-0009-1111-1111-111111111111",
        name: "system.systemuser.audit",
        description: "can audit system users",
      },

      // ================== QR CODE MODULE ==================
      {
        id: "99999999-0001-1111-1111-111111111111",
        name: "qrcode.view",
        description: "can access QR code module",
      },
      {
        id: "99999999-0002-1111-1111-111111111111",
        name: "qrcode.manage",
        description: "can manage QR codes",
      },

      // ================== PURCHASE MODULE ==================
      {
        id: "aaaaaaaa-0001-1111-1111-111111111111",
        name: "purchase.view",
        description: "can access purchase module",
      },
      {
        id: "aaaaaaaa-0002-1111-1111-111111111111",
        name: "purchase.manage",
        description: "can manage purchases",
      },
    ];

    console.log(`📊 Seeding ${PERMISSIONS.length} permissions...`);

    // Batch insert permissions
    const permissionValues = PERMISSIONS.map((p) => {
      const name = p.name.replace(/'/g, "''");
      const desc = (p.description || "").replace(/'/g, "''");
      return `('${p.id}', '${name}', '${desc}', NOW(), NOW())`;
    }).join(",");

    await sequelize.query(
      `
        INSERT INTO public.permissions (id, name, description, created_at, updated_at)
        VALUES ${permissionValues}
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            description = EXCLUDED.description,
            updated_at = NOW();
      `,
      { transaction }
    );

    console.log("✅ All permissions inserted/updated");

    // Clear existing role permissions for ADMIN role ONLY
    await sequelize.query(
      `DELETE FROM public.role_permissions WHERE role_id = :role_id;`,
      {
        replacements: { role_id: ADMIN_ROLE_ID },
        transaction,
      }
    );

    // Get all permission IDs
    const [permissionRows] = await sequelize.query(`SELECT id FROM public.permissions;`, {
      transaction,
    });

    const permissions = permissionRows as Array<{ id: string }>;

    // Assign ALL permissions to ADMIN role
    const adminRolePermissionValues = permissions
      .map((permission) => `('${ADMIN_ROLE_ID}', '${permission.id}', NOW(), NOW())`)
      .join(",");

    if (adminRolePermissionValues) {
      await sequelize.query(
        `
          INSERT INTO public.role_permissions (role_id, permission_id, created_at, updated_at)
          VALUES ${adminRolePermissionValues}
          ON CONFLICT (role_id, permission_id) DO NOTHING;
        `,
        { transaction }
      );
    }

    console.log(`✅ Assigned ${permissions.length} permissions to ADMIN role`);

    // --- CREATE VIEWER ROLE -----------------------------------------
    await sequelize.query(
      `
        INSERT INTO public.roles (id, name, level, created_at, updated_at)
        VALUES (:id, :name, :level, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            level = EXCLUDED.level,
            updated_at = NOW();
      `,
      {
        replacements: {
          id: VIEWER_ROLE_ID,
          name: "Viewer",
          level: 999,
        },
        transaction,
      }
    );

    console.log(`✅ Viewer role ensured (ID: ${VIEWER_ROLE_ID})`);

    // Assign view-only permissions to VIEWER role
    const viewerPermissions = [
      "dashboard.view",
      "profile.view",
      "sales.dashboard.view",
      "sales.clients.view",
      "accounts.dashboard.view",
      "accounts.ledger.view",
    ];

    // Clear existing viewer permissions
    await sequelize.query(
      `DELETE FROM public.role_permissions WHERE role_id = :role_id;`,
      {
        replacements: { role_id: VIEWER_ROLE_ID },
        transaction,
      }
    );

    // Get viewer permission IDs
    const [viewerPermRows] = await sequelize.query(
      `SELECT id FROM public.permissions WHERE name IN (:permissionNames);`,
      {
        replacements: {
          permissionNames: viewerPermissions,
        },
        transaction,
      }
    );

    const viewerPerms = viewerPermRows as Array<{ id: string }>;

    if (viewerPerms.length > 0) {
      const viewerRolePermissionValues = viewerPerms
        .map((perm) => `('${VIEWER_ROLE_ID}', '${perm.id}', NOW(), NOW())`)
        .join(",");

      await sequelize.query(
        `
          INSERT INTO public.role_permissions (role_id, permission_id, created_at, updated_at)
          VALUES ${viewerRolePermissionValues}
          ON CONFLICT (role_id, permission_id) DO NOTHING;
        `,
        { transaction }
      );

      console.log(`✅ Assigned ${viewerPerms.length} permissions to VIEWER role`);
    }

    await transaction.commit();

    console.log("\n🎉 Database seeding completed successfully!");
    console.log("\n📋 PERMISSION SUMMARY:");
    console.log("======================");
    console.log("Total permissions:", permissions.length);
    console.log("Admin role permissions:", permissions.length);
    console.log("Viewer role permissions:", viewerPerms.length);
  } catch (error) {
    await transaction.rollback();
    console.error("❌ Seeding failed:", error);

    if (error instanceof Error) {
      console.error("Error message:", error.message);
      if ("sql" in (error as any)) {
        console.error("SQL:", (error as any).sql);
      }
    }

    throw error;
  }
}

export default syncDatabase;
