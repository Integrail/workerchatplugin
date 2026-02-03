import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file if it exists
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=');
            if (key && value !== undefined) {
                process.env[key.trim()] = value.trim();
            }
        }
    });
}

// Environment configuration
const config = {
    endpoint: process.env.EVERWORKER_ENDPOINT || 'ws://localhost:3000',
    workerId: process.env.EVERWORKER_WORKER_ID || '',
    token: process.env.EVERWORKER_TOKEN || ''
};

const PORT = 8001;

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.map': 'application/json'
};

const server = createServer((req, res) => {
    let filePath = req.url === '/' ? '/examples/simple.html' : req.url;
    
    // Remove query string
    filePath = filePath.split('?')[0];
    
    // Security check - prevent directory traversal
    if (filePath.includes('..')) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    
    const fullPath = join(__dirname, filePath);
    const ext = extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    try {
        let content = readFileSync(fullPath);

        // Inject environment config into HTML files
        if (ext === '.html') {
            const configScript = `<script>
window.__EVERWORKER_CONFIG__ = {
    endpoint: "${config.endpoint}",
    workerId: "${config.workerId}",
    token: "${config.token}"
};
</script>`;
            content = content.toString().replace('</head>', `${configScript}\n</head>`);
        }

        res.writeHead(200, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*'
        });
        res.end(content);
    } catch (err) {
        if (err.code === 'ENOENT') {
            res.writeHead(404);
            res.end('File not found');
        } else {
            res.writeHead(500);
            res.end('Server error');
        }
    }
});

server.listen(PORT, () => {
    console.log(`🚀 Test server running at http://localhost:${PORT}`);
    console.log(`📝 Simple example: http://localhost:${PORT}/examples/simple.html`);
    console.log(`🔧 Advanced example: http://localhost:${PORT}/examples/advanced.html`);
});