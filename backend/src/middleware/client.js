const CLIENT_ID_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

const requireClient = (req, res, next) => {
    const id = req.get("x-client-id");

    if (!id || !CLIENT_ID_PATTERN.test(id)) {
        return res.status(400).json({
            success: false,
            message: "Missing or invalid client id"
        });
    }

    req.ownerId = id;
    next();
};

module.exports = { requireClient };