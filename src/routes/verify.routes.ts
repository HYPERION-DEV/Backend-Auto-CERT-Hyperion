// backend-hyperion/src/routes/verify.route.ts

import { Router } from 'express';
import multer from 'multer';
import { handleVerifyDni, handleSendToCamerfirma } from '../controllers/certificate.controller';

const upload = multer({ dest: 'uploads/' });
const router = Router();

// 1. Creación e inserción inicial del borrador + carga de archivos multipart
router.post(
  '/verify/dni',
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'fileRuc', maxCount: 1 },
    { name: 'fileVigencia', maxCount: 1 },
  ]),
  handleVerifyDni
);

// 2. Disparo explícito del web scraping desde el detalle del certificado (/certificates/[id])
router.post('/certificates/:id/submit-external', handleSendToCamerfirma);

export default router;