// src/models/index.ts
import { Sequelize } from "sequelize";
import { db } from "../database/DBService";

// ── Model initializers (1 file = 1 init function) ──────────────────────────────
import { initSystemUserModel } from "./SystemUser";
import { initUserRoleModel } from "./UserRole";
import { initRoleModel } from "./Role";
import { initPermissionModel } from "./Permission";
import { initRolePermissionModel } from "./RolePermission";
import { initSystemUserSecretModel } from "./SystemUserSecret";

import { Worker as WorkerModel } from "./Worker";

import initCategoryModel from "./Category";
import { initJobModel } from "./Job";
import { initPendingMaterialModel } from "./PendingMaterial";
import { initPoServiceModel } from "./PoService";
import { AssignToWorker as AssignToWorkerModel } from "./AssignToWorker";


const sequelize = db.write;

// ── 1) Initialize all models ───────────────────────────────────────────────────
const dbModels: any = {
  Sequelize,
  sequelize,

  // Core / AuthZ
  SystemUser: initSystemUserModel(sequelize),
  UserRole: initUserRoleModel(sequelize),
  Role: initRoleModel(sequelize),
  Permission: initPermissionModel(sequelize),
  RolePermission: initRolePermissionModel(sequelize),
  SystemUserSecret: initSystemUserSecretModel(sequelize),
  Worker: WorkerModel.initModel(sequelize),

  Category: initCategoryModel(sequelize),
  Job: initJobModel(sequelize),
  PendingMaterial: initPendingMaterialModel(sequelize),
  PoService: initPoServiceModel(sequelize),
  AssignToWorker: AssignToWorkerModel.initModel(sequelize),

};

// ── 2) Associations ───────────────────────────────────────────────────────────

// ==================== RBAC ASSOCIATIONS ====================
dbModels.Role.belongsToMany(dbModels.Permission, {
  through: dbModels.RolePermission,
  foreignKey: "role_id",
  otherKey: "permission_id",
  as: "permissions",
});
dbModels.Permission.belongsToMany(dbModels.Role, {
  through: dbModels.RolePermission,
  foreignKey: "permission_id",
  otherKey: "role_id",
  as: "roles",
});

dbModels.SystemUser.belongsToMany(dbModels.Role, {
  through: dbModels.UserRole,
  foreignKey: "system_user_id",
  otherKey: "role_id",
  as: "roles",
});
dbModels.Role.belongsToMany(dbModels.SystemUser, {
  through: dbModels.UserRole,
  foreignKey: "role_id",
  otherKey: "system_user_id",
  as: "users",
});

// ==================== JOB & CATEGORY ASSOCIATIONS ====================
// A Job (if it's a JOB_SERVICE) can belong to a Category via job_no
// IMPORTANT: This assumes `job_no` is a UNIQUE key in the `category` table.
dbModels.Job.belongsTo(dbModels.Category, {
  foreignKey: "job_no",
  targetKey: "job_no",
  as: "categoryDetails",
});

// A Category can have many Jobs associated with it via job_no
dbModels.Category.hasMany(dbModels.Job, {
  foreignKey: "job_no",
  sourceKey: "job_no",
  as: "jobs",
});

dbModels.PendingMaterial.belongsTo(dbModels.Category, {
  foreignKey: "job_no",
  targetKey: "job_no",
  as: "category",
});

dbModels.Category.hasMany(dbModels.PendingMaterial, {
  foreignKey: "job_no",
  sourceKey: "job_no",
  as: "pendingMaterials",
});

dbModels.PoService.belongsTo(dbModels.Category, {
  foreignKey: "job_no",
  targetKey: "job_no",
  as: "category",
});

dbModels.Category.hasMany(dbModels.PoService, {
  foreignKey: "job_no",
  sourceKey: "job_no",
  as: "poServices",
});

dbModels.SystemUser.hasMany(dbModels.SystemUserSecret, {
  foreignKey: "user_id",
  as: "secrets",
});
dbModels.SystemUserSecret.belongsTo(dbModels.SystemUser, {
  foreignKey: "user_id",
  as: "user",
});

dbModels.AssignToWorker.belongsTo(dbModels.Job, {
  foreignKey: "job_id",
  as: "job",
});

dbModels.Job.hasMany(dbModels.AssignToWorker, {
  foreignKey: "job_id",
  as: "assignments",
});


// ── 3) Export registry & bound sequelize ───────────────────────────────────────
export default dbModels;

export const {
  SystemUser,
  Category,
  Job,
  PendingMaterial,
  PoService,
  AssignToWorker,
  Worker,
  // Add other models you need
} = dbModels;

export const { sequelize: sequelizeWriterBound } = dbModels;
export { sequelize };
