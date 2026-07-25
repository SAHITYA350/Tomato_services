import express from "express";
import cloudinary from "cloudinary";

const router = express.Router();

router.post("/upload", async (req, res) => {
  try {
      const { buffer } = req.body;
      if (!buffer) {
        return res.status(400).json({ message: "Buffer (Base64 Data URI) is required" });
      }
      const cloud = await cloudinary.v2.uploader.upload(buffer, {
        resource_type: "auto",
      });
      res.status(200).json({
        message: "File uploaded successfully",
        url: cloud.secure_url,
      });
  } catch (error : any) {
    console.error(error);
    res.status(500).json({ 
        message: error.message,
     });
  }
});

export default router;