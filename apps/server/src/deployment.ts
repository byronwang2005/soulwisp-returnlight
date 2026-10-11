import { createServer } from 'node:http';

let draining = false;
export function isDraining() { return draining; }
export function assertAdmissionOpen() {
  if (draining) throw new Error('服务正在更新，请稍后重新进入远征');
}

// Accessible only inside the container; this listener is never published.
export function createDeploymentAdmin(roomCount: () => number, port = 3001, pendingSettlements: () => number = () => 0) {
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/drain') draining = true;
    else if (request.method === 'POST' && request.url === '/resume') draining = false;
    else if (request.method !== 'GET' || request.url !== '/status') {
      response.writeHead(404).end(); return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ draining, rooms: roomCount(), pendingSettlements: pendingSettlements(), revision: process.env.RELEASE_SHA ?? null }));
  });
  server.listen(port, '127.0.0.1');
  return server;
}
