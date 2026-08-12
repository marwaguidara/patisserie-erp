const app = require('../src/app');

function listRoutes() {
  const routes = [];
  const stack = app._router ? app._router.stack : (app.router ? app.router.stack : null);
  if (!stack) {
    console.error('No router stack found on app');
    return;
  }
  stack.forEach((middleware) => {
    if (middleware.route) {
      // routes registered directly on the app
      const methods = Object.keys(middleware.route.methods).join(',').toUpperCase();
      routes.push({ path: middleware.route.path, methods });
    } else if (middleware.name === 'router' && middleware.handle && middleware.handle.stack) {
      // router middleware
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          const methods = Object.keys(handler.route.methods).join(',').toUpperCase();
          routes.push({ path: handler.route.path, methods });
        }
      });
    }
  });
  console.log(JSON.stringify(routes, null, 2));
}

listRoutes();
