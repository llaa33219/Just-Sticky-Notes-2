// API 엔드포인트 처리
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
        
        const url = new URL(request.url);
        const path = url.pathname.replace('/api', '');
        
        switch (path) {
            case '/notes':
                if (request.method === 'GET') {
                    const notes = await loadNotesFromR2(env);
                    return new Response(JSON.stringify(notes), {
                        headers: {
                            'Content-Type': 'application/json',
                            ...CORS_HEADERS
                        }
                    });
                }
                break;
                
            case '/health':
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
                
            case '/debug':
                // 디버깅용 엔드포인트
                const debugInfo = {
                    r2BucketStatus: env.STICKY_NOTES_BUCKET ? 'connected' : 'not_found',
                    timestamp: new Date().toISOString()
                };
                
                return new Response(JSON.stringify(debugInfo, null, 2), {
                    headers: {
                        'Content-Type': 'application/json',
                        ...CORS_HEADERS
                    }
                });
                
            default:
                return new Response(JSON.stringify({
                    error: 'Not Found',
                    path: path
                }), { 
                    status: 404,
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

// R2에서 노트 로드
async function loadNotesFromR2(env) {
    try {
        if (!env.STICKY_NOTES_BUCKET) {
            console.warn('STICKY_NOTES_BUCKET이 설정되지 않음');
            return [];
        }
        
        console.log('R2에서 notes.json 로딩 시도...');
        const notesObject = await env.STICKY_NOTES_BUCKET.get('notes.json');
        if (!notesObject) {
            console.log('notes.json 파일이 존재하지 않음, 빈 배열 반환');
            return [];
        }
        
        const notesData = await notesObject.text();
        const notes = JSON.parse(notesData);
        console.log(`R2에서 ${notes.length}개의 노트 로드됨`);
        return notes;
    } catch (error) {
        console.error('R2에서 노트 로드 오류:', error);
        return [];
    }
} 