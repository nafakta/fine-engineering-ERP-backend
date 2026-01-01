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
     * - In DEV: alter=true
     * - In PROD: alter=false by default
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

    // ✅ Ensure extensions BEFORE sync
    await sequelize.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    await sequelize.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // ✅ Debug: show what models are actually loaded
    const loadedModels = Object.keys(sequelize.models || {});
    console.log("📦 Loaded Sequelize models:", loadedModels);

    // ✅ Sync all loaded models
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
  const qi = sequelize.getQueryInterface();

  // ✅ NOTE: describeTable typings don't accept transaction -> don't pass it.
  const hasColumn = async (table: string, column: string) => {
    try {
      const desc = await qi.describeTable(table);
      return Object.prototype.hasOwnProperty.call(desc, column);
    } catch {
      return false;
    }
  };

  const buildRoleUpsertSql = async () => {
    const hasCreatedAt = await hasColumn("roles", "created_at");
    const hasUpdatedAt = await hasColumn("roles", "updated_at");

    const cols = ["id", "name", "level"];
    const vals = [":id", ":name", ":level"];

    if (hasCreatedAt) {
      cols.push("created_at");
      vals.push("NOW()");
    }
    if (hasUpdatedAt) {
      cols.push("updated_at");
      vals.push("NOW()");
    }

    const setParts = ["name = EXCLUDED.name", "level = EXCLUDED.level"];
    if (hasUpdatedAt) setParts.push("updated_at = NOW()");

    return `
      INSERT INTO public.roles (${cols.join(", ")})
      VALUES (${vals.join(", ")})
      ON CONFLICT (id) DO UPDATE
      SET ${setParts.join(", ")}
      RETURNING id;
    `;
  };

  const buildPermissionsUpsertSql = async (
    perms: Array<{ id: string; name: string; description?: string }>
  ) => {
    const hasCreatedAt = await hasColumn("permissions", "created_at");
    const hasUpdatedAt = await hasColumn("permissions", "updated_at");

    const insertCols = ["id", "name", "description"];
    if (hasCreatedAt) insertCols.push("created_at");
    if (hasUpdatedAt) insertCols.push("updated_at");

    const valueRows = perms
      .map((p) => {
        const name = (p.name || "").replace(/'/g, "''");
        const desc = (p.description || "").replace(/'/g, "''");

        const v: string[] = [`'${p.id}'`, `'${name}'`, `'${desc}'`];
        if (hasCreatedAt) v.push("NOW()");
        if (hasUpdatedAt) v.push("NOW()");
        return `(${v.join(", ")})`;
      })
      .join(",");

    const setParts = ["name = EXCLUDED.name", "description = EXCLUDED.description"];
    if (hasUpdatedAt) setParts.push("updated_at = NOW()");

    return `
      INSERT INTO public.permissions (${insertCols.join(", ")})
      VALUES ${valueRows}
      ON CONFLICT (id) DO UPDATE
      SET ${setParts.join(", ")};
    `;
  };

  const buildRolePermissionsInsertSql = async (pairs: Array<{ roleId: string; permId: string }>) => {
    const hasCreatedAt = await hasColumn("role_permissions", "created_at");
    const hasUpdatedAt = await hasColumn("role_permissions", "updated_at");

    const insertCols = ["role_id", "permission_id"];
    if (hasCreatedAt) insertCols.push("created_at");
    if (hasUpdatedAt) insertCols.push("updated_at");

    const values = pairs
      .map(({ roleId, permId }) => {
        const v: string[] = [`'${roleId}'`, `'${permId}'`];
        if (hasCreatedAt) v.push("NOW()");
        if (hasUpdatedAt) v.push("NOW()");
        return `(${v.join(", ")})`;
      })
      .join(",");

    return `
      INSERT INTO public.role_permissions (${insertCols.join(", ")})
      VALUES ${values}
      ON CONFLICT (role_id, permission_id) DO NOTHING;
    `;
  };

  try {
    console.log("🌱 Starting initial data seeding...");

    const ADMIN_ROLE_ID = "11111111-1111-1111-1111-111111111111";
    const VIEWER_ROLE_ID = "22222222-2222-2222-2222-222222222222";

    // Extensions (use transaction here ✅)
    await sequelize.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`, { transaction });
    await sequelize.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`, { transaction });

    const PERMISSIONS = [
      { id: "00000000-0001-1111-1111-111111111111", name: "dashboard.view", description: "can access dashboard" },
      { id: "00000000-0002-1111-1111-111111111111", name: "profile.view", description: "can view profile" },

      { id: "88888888-0001-1111-1111-111111111111", name: "system.masterroles.view", description: "can view master roles" },
      { id: "88888888-0002-1111-1111-111111111111", name: "system.masterroles.manage", description: "can manage master roles" },
      { id: "88888888-0003-1111-1111-111111111111", name: "system.settings.view", description: "can view settings" },
      { id: "88888888-0004-1111-1111-111111111111", name: "system.settings.manage", description: "can manage settings" },
      { id: "88888888-0005-1111-1111-111111111111", name: "system.systemuser.view", description: "can view system users" },
      { id: "88888888-0006-1111-1111-111111111111", name: "system.systemuser.add", description: "can add system users" },
      { id: "88888888-0007-1111-1111-111111111111", name: "system.systemuser.edit", description: "can edit system users" },
      { id: "88888888-0008-1111-1111-111111111111", name: "system.systemuser.delete", description: "can delete system users" },
      { id: "88888888-0009-1111-1111-111111111111", name: "system.systemuser.audit", description: "can audit system users" },
    ];

    // ✅ Role Upsert (safe for missing timestamps)
    const roleUpsertSQL = await buildRoleUpsertSql();

    await sequelize.query(roleUpsertSQL, {
      replacements: { id: ADMIN_ROLE_ID, name: "Admin", level: 1 },
      transaction,
    });

    console.log(`✅ Admin role ensured (ID: ${ADMIN_ROLE_ID})`);

    console.log(`📊 Seeding ${PERMISSIONS.length} permissions...`);

    // ✅ Permissions upsert (safe for missing timestamps)
    const permissionsUpsertSQL = await buildPermissionsUpsertSql(PERMISSIONS);
    await sequelize.query(permissionsUpsertSQL, { transaction });

    console.log("✅ All permissions inserted/updated");

    // Clear existing ADMIN permissions
    await sequelize.query(`DELETE FROM public.role_permissions WHERE role_id = :role_id;`, {
      replacements: { role_id: ADMIN_ROLE_ID },
      transaction,
    });

    // Load permission ids
    const [permissionRows] = await sequelize.query(`SELECT id FROM public.permissions;`, { transaction });
    const permissions = permissionRows as Array<{ id: string }>;

    // Assign all to ADMIN
    if (permissions.length > 0) {
      const pairs = permissions.map((p) => ({ roleId: ADMIN_ROLE_ID, permId: p.id }));
      const sql = await buildRolePermissionsInsertSql(pairs);
      await sequelize.query(sql, { transaction });
    }

    console.log(`✅ Assigned ${permissions.length} permissions to ADMIN role`);

    // Viewer role
    await sequelize.query(roleUpsertSQL, {
      replacements: { id: VIEWER_ROLE_ID, name: "Viewer", level: 999 },
      transaction,
    });

    console.log(`✅ Viewer role ensured (ID: ${VIEWER_ROLE_ID})`);

    // Viewer permissions by name
    const viewerPermissionNames = [
      "dashboard.view",
      "profile.view",
    ];

    await sequelize.query(`DELETE FROM public.role_permissions WHERE role_id = :role_id;`, {
      replacements: { role_id: VIEWER_ROLE_ID },
      transaction,
    });

    const [viewerPermRows] = await sequelize.query(
      `SELECT id FROM public.permissions WHERE name IN (:permissionNames);`,
      {
        replacements: { permissionNames: viewerPermissionNames },
        transaction,
      }
    );

    const viewerPerms = viewerPermRows as Array<{ id: string }>;

    if (viewerPerms.length > 0) {
      const pairs = viewerPerms.map((p) => ({ roleId: VIEWER_ROLE_ID, permId: p.id }));
      const sql = await buildRolePermissionsInsertSql(pairs);
      await sequelize.query(sql, { transaction });
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
      if ("sql" in (error as any)) console.error("SQL:", (error as any).sql);
    }

    throw error;
  }
}

export default syncDatabase;
