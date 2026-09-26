const express = require('express');
const statusRoute = require('./status/route');
const sendLinkRoute = require('./send-link/route');
const verifyLinkRoute = require('./verify-link/route');
const reactivateRoute = require('./reactivate/route');
const statsRoute = require('./stats/route');
const keysRoute = require('./keys/route');
const { requireApiKey, optionalApiKey } = require('../../lib/middleware');

const router = express.Router();

// Public health & stats
router.use('/status', statusRoute);
router.use('/stats', statsRoute);

// Admin keys management
router.use('/keys', keysRoute);

// Alight Motion Activator endpoints.
// API key hanya diwajibkan untuk akses via POST langsung (client API).
// Request dari Web UI (Origin/Referer sama host) diputuskan oleh optionalApiKey:
// - dari web sendiri: gratis, tanpa key
// - dari luar (postman/bot/script): wajib key
router.use('/send-link', optionalApiKey, sendLinkRoute);
router.use('/verify-link', optionalApiKey, verifyLinkRoute);
router.use('/reactivate', optionalApiKey, reactivateRoute);
// Struktur moduler ala ampremtools: verify + provision terpisah
router.use('/', optionalApiKey, reactivateRoute);

module.exports = router;
