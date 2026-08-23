import http from 'node:http';

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>StudyPilot E2E fixture</title>
  </head>
  <body>
    <h1>Photosynthesis lecture notes</h1>
    <p>A local page used to load the unpacked StudyPilot content script.</p>
  </body>
</html>`;

const server = http.createServer((request, response) => {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(html);
});

server.listen(4177, '127.0.0.1', () => {
  process.stdout.write('e2e fixture listening on http://127.0.0.1:4177/\n');
});
