import cloudinary from './config/cloudinary.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

console.log("Cloud config:", cloudinary.config().cloud_name);

async function testUpload() {
    try {
        // create a dummy PDF file content in memory
        const dummyPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000113 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n185\n%%EOF');
        
        const b64 = dummyPdf.toString('base64');
        const dataURI = `data:application/pdf;base64,${b64}`;

        const uniqueFileName = `resume-${Date.now()}-${Math.round(Math.random() * 1E9)}.pdf`;
        const result = await cloudinary.uploader.upload(dataURI, {
            folder: 'resumes',
            resource_type: 'raw',
            access_mode: 'public',
            public_id: uniqueFileName
        });

        // Generate a signed URL (even for public assets, sometimes signatures fix 401s on restricted accounts)
        const signedUrl = cloudinary.url(result.public_id, {
            resource_type: 'raw',
            secure: true,
            sign_url: true,
            type: 'upload'
        });

        const output = `URL: ${result.secure_url}\nSigned URL: ${signedUrl}\nResource Type: ${result.resource_type}\nFull Result: ${JSON.stringify(result, null, 2)}`;
        fs.writeFileSync('cloudinary_test_output.txt', output);
        console.log("Details written to cloudinary_test_output.txt");
    } catch (e) {
        fs.writeFileSync('cloudinary_test_output.txt', `Upload failed: ${e.message}\n${e.stack}`);
        console.error("Upload failed", e);
    }
}

testUpload();
