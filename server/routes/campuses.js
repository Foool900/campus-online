import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

// GET /api/campuses —— 列出所有校区
router.get('/campuses', (req, res) => {
  const campuses = db.prepare('SELECT * FROM campuses ORDER BY id ASC').all();
  res.json(campuses);
});

export default router;
