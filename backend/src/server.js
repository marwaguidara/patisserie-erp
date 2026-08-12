require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`[Bakery Platform API] Server running on http://localhost:${PORT}`);
  console.log(`[Bakery Platform API] Environment: ${process.env.NODE_ENV || 'development'}`);
});
