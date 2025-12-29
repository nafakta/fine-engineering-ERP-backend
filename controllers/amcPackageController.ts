// src/controllers/amcPackageController.ts
import { Request, Response } from "express";
import * as Yup from "yup";
import db from "../models";

const AmcPackage = db.AmcPackage;

// VALIDATION
const createSchema = Yup.object({
  name: Yup.string().required("Package name is required"),
});

// CREATE
export async function createAmcPackage(req: Request, res: Response) {
  try {
    const payload = await createSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    const pkg = await AmcPackage.create({
      name: payload.name,
    });

    return res.json({
      success: true,
      message: "AMC package created successfully",
      data: {
        id: pkg.id,
        name: pkg.name,
      },
    });
  } catch (err: any) {
    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        error: err.errors,
      });
    }
    console.error("createAmcPackage error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
}

// LIST  (✔ only id + name, ✔ no TS error)
export async function listAmcPackages(req: Request, res: Response) {
  try {
    const pkgs = await AmcPackage.findAll({
      order: [["created_at", "DESC"]],
    });

    // FIX TYPE ERROR + return only id & name
    const data: { id: string; name: string }[] = pkgs.map((p: any) => ({
      id: p.id,
      name: p.name,
    }));

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("listAmcPackages error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
}
