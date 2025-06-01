// /api/debug 엔드포인트 처리
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
            // 디버깅용 엔드포인트
            const debugInfo = {
                r2BucketStatus: env.STICKY_NOTES_BUCKET ? 'connected' : 'not_found',
                timestamp: new Date().toISOString(),
                environment: Object.keys(env)
            };
            
            return new Response(JSON.stringify(debugInfo, null, 2), {
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