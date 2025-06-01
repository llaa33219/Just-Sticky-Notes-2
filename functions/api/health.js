// /api/health 엔드포인트 처리
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
    const { request, env } = context;
    
    try {
        // CORS preflight 처리
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 200,
                headers: CORS_HEADERS
            });
        }
        
        if (request.method === 'GET') {
            return new Response(JSON.stringify({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                version: '1.0.0',
                r2Bucket: env.STICKY_NOTES_BUCKET ? 'connected' : 'not_found'
            }), {
                headers: {
                    'Content-Type': 'application/json',
                    ...CORS_HEADERS
                }
            });
        }
        
        return new Response(JSON.stringify({
            error: 'Method not allowed'
        }), { 
            status: 405,
            headers: {
                'Content-Type': 'application/json',
                ...CORS_HEADERS
            }
        });
        
    } catch (error) {
        console.error('API 처리 오류:', error);
        return new Response(JSON.stringify({
            error: 'Internal Server Error',
            message: error.message
        }), { 
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...CORS_HEADERS
            }
        });
    }
} 