import { Request, Response } from "express";
import * as Yup from "yup";
import { QueryTypes } from "sequelize";
import db from "../models";

const ok = (res: Response, data: any = null, extra: any = {}) =>
  res.json({ success: true, data, ...extra });
const err = (res: Response, message = "Internal server error", status = 500) =>
  res.status(status).json({ success: false, message });

/** Create */
export const createAmcDealPackage = async (req: Request, res: Response) => {
  try {
    const schema = Yup.object({
      package_name: Yup.string()
        .trim()
        .required("package_name is required")
        .max(255),
      package_details: Yup.string()
        .trim()
        .required("package_details is required"),
    });
    const body = await schema.validate(req.body, { abortEarly: false });

    const userId = (req as any)?.user?.userId || null;

    const rows: any[] = await db.sequelize.query(
      `
      INSERT INTO amc_deal_packages
        (id, package_name, package_details, is_active, created_by, updated_by, created_at, updated_at)
      VALUES
        (gen_random_uuid(), :package_name, :package_details, TRUE, :user_id, :user_id, NOW(), NOW())
      ON CONFLICT (package_name) DO NOTHING
      RETURNING *;
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          package_name: body.package_name,
          package_details: body.package_details,
          user_id: userId,
        },
      }
    );

    if (!rows.length) return err(res, "package_name already exists", 409);
    return ok(res, rows[0]);
  } catch (e: any) {
    if (e instanceof Yup.ValidationError)
      return err(res, e.errors.join(", "), 400);
    return err(res);
  }
};

/** List (search + pagination) */
export const listAmcDealPackages = async (req: Request, res: Response) => {
  try {
    const page = Math.max(parseInt(String(req.query.page ?? "1"), 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1),
      100
    );
    const offset = (page - 1) * limit;
    const q = String(req.query.q ?? "").trim();
    const includeInactive =
      String(req.query.includeInactive ?? "false").toLowerCase() === "true";

    const where: string[] = [];
    if (q)
      where.push(
        `(package_name ILIKE '%' || :q || '%' OR package_details ILIKE '%' || :q || '%')`
      );
    if (!includeInactive) where.push(`is_active = TRUE`);
    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows: any[] = await db.sequelize.query(
      `
      SELECT *
      FROM amc_deal_packages
      ${whereSQL}
      ORDER BY package_name ASC
      LIMIT :limit OFFSET :offset;
      `,
      { type: QueryTypes.SELECT, replacements: { q, limit, offset } }
    );

    const [countRow]: any = await db.sequelize.query(
      `SELECT COUNT(*)::int AS count FROM amc_deal_packages ${whereSQL};`,
      { type: QueryTypes.SELECT, replacements: { q } }
    );

    return ok(res, rows, {
      pagination: { page, limit, total: countRow?.count ?? 0 },
    });
  } catch (e) {
    return err(res);
  }
};

/** Get by ID */
export const getAmcDealPackageById = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const rows: any[] = await db.sequelize.query(
      `SELECT * FROM amc_deal_packages WHERE id = :id;`,
      { type: QueryTypes.SELECT, replacements: { id } }
    );

    if (!rows.length) return err(res, "Not found", 404);
    return ok(res, rows[0]);
  } catch (e) {
    return err(res);
  }
};

/** Update (ID comes from BODY, not params) */
export const updateAmcDealPackage = async (req: Request, res: Response) => {
  try {
    const schema = Yup.object({
      id: Yup.string().uuid().required("id is required"),
      package_name: Yup.string()
        .trim()
        .max(255)
        .required("package_name is required"),
      package_details: Yup.string()
        .trim()
        .required("package_details is required"),
      is_active: Yup.boolean().optional(),
    });

    // ✅ validate req.body only (no params)
    const body = await schema.validate(req.body, { abortEarly: false });

    const userId = (req as any)?.user?.userId || null;

    const rows: any[] = await db.sequelize.query(
      `
      UPDATE amc_deal_packages
      SET package_name    = :package_name,
          package_details = :package_details,
          is_active       = COALESCE(:is_active, is_active),
          updated_by      = :user_id,
          updated_at      = NOW()
      WHERE id = :id
      RETURNING *;
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          id: body.id,
          package_name: body.package_name,
          package_details: body.package_details,
          is_active: body.is_active ?? null,
          user_id: userId,
        },
      }
    );

    if (!rows.length) return err(res, "Not found", 404);
    return ok(res, rows[0]);
  } catch (e: any) {
    if (e instanceof Yup.ValidationError)
      return err(res, e.errors.join(", "), 400);
    if (String(e?.message || "").includes("duplicate key"))
      return err(res, "package_name already exists", 409);
    return err(res);
  }
};

/** Soft delete (inactive) */
export const softDeleteAmcDealPackage = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const rows: any[] = await db.sequelize.query(
      `
      UPDATE amc_deal_packages
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = :id AND is_active = TRUE
      RETURNING *;
      `,
      { type: QueryTypes.SELECT, replacements: { id } }
    );

    if (!rows.length) return err(res, "Not found or already inactive", 404);
    return ok(res, rows[0]);
  } catch (e) {
    return err(res);
  }
};

/** Restore (active) */
export const restoreAmcDealPackage = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const rows: any[] = await db.sequelize.query(
      `
      UPDATE amc_deal_packages
      SET is_active = TRUE, updated_at = NOW()
      WHERE id = :id AND is_active = FALSE
      RETURNING *;
      `,
      { type: QueryTypes.SELECT, replacements: { id } }
    );

    if (!rows.length) return err(res, "Not found or already active", 404);
    return ok(res, rows[0]);
  } catch (e) {
    return err(res);
  }
};

/** Hard delete */
export const hardDeleteAmcDealPackage = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    await db.sequelize.query(`DELETE FROM amc_deal_packages WHERE id = :id;`, {
      type: QueryTypes.DELETE,
      replacements: { id },
    });

    return ok(res, { id });
  } catch (e) {
    return err(res);
  }
};

/** Dropdown (id + text) - optional helper */
export const listAmcDealPackagesDropdown = async (
  _req: Request,
  res: Response
) => {
  try {
    const rows: any[] = await db.sequelize.query(
      `
      SELECT id AS value, package_name AS label
      FROM amc_deal_packages
      WHERE is_active = TRUE
      ORDER BY package_name ASC;
      `,
      { type: QueryTypes.SELECT }
    );
    return ok(res, rows);
  } catch (e) {
    return err(res);
  }
};
