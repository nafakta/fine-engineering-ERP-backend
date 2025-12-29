// src/controllers/quotationController.ts
import { Request, Response } from "express";
import { Quotation } from "../models/Quotation";
import { Boq } from "../models/boq";
import { Vendor } from "../models/vendor";
import { SystemUser } from "../models/SystemUser";
import { Op } from "sequelize";
import path from "path";
import fs from "fs";

export class QuotationController {

    // Upload multiple quotations
    public uploadQuotations = async (req: Request, res: Response): Promise<void> => {
        try {
            const { boqId } = req.body;
            const userId = (req as any).user?.id;

            if (!boqId) {
                res.status(400).json({
                    success: false,
                    message: "BOQ ID is required"
                });
                return;
            }

            // Check if BOQ exists
            const boq = await Boq.findByPk(boqId);
            if (!boq) {
                res.status(404).json({
                    success: false,
                    message: "BOQ not found"
                });
                return;
            }

            const quotationsData = [];
            const files = req.files as Express.Multer.File[];

            // Parse quotation data from form fields
            if (typeof req.body.quotations === 'string') {
                quotationsData.push(...JSON.parse(req.body.quotations));
            } else {
                res.status(400).json({
                    success: false,
                    message: "Invalid quotations data format"
                });
                return;
            }

            const createdQuotations = [];

            for (let i = 0; i < quotationsData.length; i++) {
                const quotationData = quotationsData[i];
                const file = files.find(f => f.fieldname === `quotations[${i}][quotation_file]`);

                if (!file) {
                    continue; // Skip if no file for this quotation
                }

                // Find or create vendor by company name
                let vendor = await Vendor.findOne({
                    where: {
                        company: quotationData.company_name
                    }
                });

                if (!vendor) {
                    vendor = await Vendor.create({
                        company: quotationData.company_name,
                        vendor: quotationData.vendor_name, // Use 'vendor' field for contact person
                        // created_by: userId
                    });
                }

                const quotation = await Quotation.create({
                    boq_id: boqId,
                    vendor_id: vendor?.id || null,
                    vendor_name: quotationData.vendor_name,
                    company_name: quotationData.company_name,
                    rate: parseFloat(quotationData.rate),
                    quotation_date: quotationData.date,
                    file_name: file.originalname,
                    file_path: file.path,
                    file_size: file.size,
                    file_mimetype: file.mimetype,
                    notes: quotationData.notes,
                    created_by: userId
                });

                createdQuotations.push(quotation);
            }

            res.status(201).json({
                success: true,
                message: "Quotations uploaded successfully",
                data: createdQuotations
            });

        } catch (error: any) {
            console.error("Error uploading quotations:", error);
            res.status(500).json({
                success: false,
                message: "Failed to upload quotations",
                error: error.message
            });
        }
    };

    // Get quotations by BOQ ID
    public getQuotationsByBoq = async (req: Request, res: Response): Promise<void> => {
        try {
            const { boqId } = req.params;
            const { sort_by = "rate", order = "ASC" } = req.query;

            const quotations = await Quotation.findAll({
                where: { boq_id: boqId },
                include: [
                    {
                        model: Boq,
                        as: "quotationBoq", // Updated to match new alias
                        attributes: ["id", "title", "boq_number", "currency"]
                    },
                    {
                        model: Vendor,
                        as: "vendor",
                        attributes: ["id", "company", "vendor", "email_id", "mobile"] // Use 'vendor' for contact person
                    },
                    {
                        model: SystemUser,
                        as: "creator",
                        attributes: ["id", "name", "email"]
                    }
                ],
                order: [[sort_by as string, order as string]],
            });

            res.json({
                success: true,
                data: quotations
            });

        } catch (error: any) {
            console.error("Error fetching quotations:", error);
            res.status(500).json({
                success: false,
                message: "Failed to fetch quotations",
                error: error.message
            });
        }
    };

    // Get quotation file
    // Get quotation file - Improved version
    public getQuotationFile = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;

            const quotation = await Quotation.findByPk(id);
            if (!quotation) {
                res.status(404).json({
                    success: false,
                    message: "Quotation not found"
                });
                return;
            }

            if (!quotation.file_path) {
                res.status(404).json({
                    success: false,
                    message: "No file attached to this quotation"
                });
                return;
            }

            // Check if file exists
            if (!fs.existsSync(quotation.file_path)) {
                res.status(404).json({
                    success: false,
                    message: "File not found on server"
                });
                return;
            }

            // Get file stats
            const stat = fs.statSync(quotation.file_path);

            // Set headers for download
            res.setHeader('Content-Type', quotation.file_mimetype || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${quotation.file_name}"`);
            res.setHeader('Content-Length', stat.size);
            res.setHeader('Cache-Control', 'no-cache');

            // Create read stream and pipe to response
            const fileStream = fs.createReadStream(quotation.file_path);

            // Handle stream errors
            fileStream.on('error', (error) => {
                console.error("File stream error:", error);
                if (!res.headersSent) {
                    res.status(500).json({
                        success: false,
                        message: "Error reading file"
                    });
                }
            });

            // Pipe file to response
            fileStream.pipe(res);

            // Handle client disconnect
            req.on('close', () => {
                fileStream.destroy();
            });

        } catch (error: any) {
            console.error("Error fetching quotation file:", error);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    message: "Failed to fetch quotation file",
                    error: error.message
                });
            }
        }
    };

    // Update quotation status
    public updateQuotationStatus = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;
            const { status } = req.body;
            const userId = (req as any).user?.id;

            if (!["submitted", "approved", "rejected"].includes(status)) {
                res.status(400).json({
                    success: false,
                    message: "Invalid status"
                });
                return;
            }

            const quotation = await Quotation.findByPk(id);
            if (!quotation) {
                res.status(404).json({
                    success: false,
                    message: "Quotation not found"
                });
                return;
            }

            await quotation.update({
                status,
                updated_by: userId
            });

            res.json({
                success: true,
                message: "Quotation status updated successfully",
                data: quotation
            });

        } catch (error: any) {
            console.error("Error updating quotation status:", error);
            res.status(500).json({
                success: false,
                message: "Failed to update quotation status",
                error: error.message
            });
        }
    };

    // Delete quotation
    public deleteQuotation = async (req: Request, res: Response): Promise<void> => {
        try {
            const { id } = req.params;

            const quotation = await Quotation.findByPk(id);
            if (!quotation) {
                res.status(404).json({
                    success: false,
                    message: "Quotation not found"
                });
                return;
            }

            // Delete file from storage
            if (quotation.file_path && fs.existsSync(quotation.file_path)) {
                fs.unlinkSync(quotation.file_path);
            }

            await quotation.destroy();

            res.json({
                success: true,
                message: "Quotation deleted successfully"
            });

        } catch (error: any) {
            console.error("Error deleting quotation:", error);
            res.status(500).json({
                success: false,
                message: "Failed to delete quotation",
                error: error.message
            });
        }
    };

    // Get lowest quotation for BOQ
    public getLowestQuotation = async (req: Request, res: Response): Promise<void> => {
        try {
            const { boqId } = req.params;

            const lowestQuotation = await Quotation.findOne({
                where: {
                    boq_id: boqId,
                    status: {
                        [Op.ne]: 'rejected'
                    }
                },
                include: [
                    {
                        model: Vendor,
                        as: "vendor",
                        attributes: ["id", "company", "vendor", "email_id", "mobile"] // Use 'vendor' for contact person
                    }
                ],
                order: [["rate", "ASC"]]
            });

            res.json({
                success: true,
                data: lowestQuotation
            });

        } catch (error: any) {
            console.error("Error fetching lowest quotation:", error);
            res.status(500).json({
                success: false,
                message: "Failed to fetch lowest quotation",
                error: error.message
            });
        }
    };


}