import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const publicFiles = new Map([
  ['/','index.html'],
  ['/index.html','index.html'],
  ['/app.js','app.js'],
  ['/styles.css','styles.css']
]);
const contentTypes = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8' };

createServer(async (req,res)=>{
  const fileName=publicFiles.get(new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname);
  if(!fileName){res.writeHead(404);return res.end('Not found');}
  try{
    const file=path.join(root,fileName);
    const content=await readFile(file);
    res.writeHead(200,{'content-type':contentTypes[path.extname(file)],'cache-control':'no-cache'});
    res.end(content);
  }catch{
    res.writeHead(500,{'content-type':'text/plain; charset=utf-8'});
    res.end('Could not load the page.');
  }
}).listen(port,'127.0.0.1',()=>console.log(`Campus Planner is ready at http://127.0.0.1:${port}`));
