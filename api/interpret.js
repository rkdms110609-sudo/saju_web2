// Vercel 서버리스 함수: 브라우저 대신 Anthropic API를 호출해주는 중계 서버
// API 키는 Vercel 환경변수(ANTHROPIC_API_KEY)에만 존재 → 웹페이지에 노출되지 않음
// 선택: ACCESS_CODE 환경변수를 설정하면 접속 코드를 아는 사람만 사용 가능 (크레딧 보호)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  // 접속 코드 검사 (ACCESS_CODE 환경변수를 설정한 경우에만 작동)
  const requiredCode = process.env.ACCESS_CODE;
  if (requiredCode && req.headers['x-access-code'] !== requiredCode) {
    return res.status(401).json({ error: '접속 코드가 올바르지 않습니다. 공유받은 링크 주소 전체를 그대로 열어주세요.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다. Vercel 환경변수를 확인하세요.' });
  }

  try {
    const { system, messages } = req.body || {};
    // 기본적인 요청 검증 (이상한 요청으로 크레딧이 새는 것 방지)
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
      return res.status(400).json({ error: '잘못된 요청 형식입니다.' });
    }
    const totalLen = JSON.stringify(messages).length;
    if (totalLen > 60000) {
      return res.status(400).json({ error: '요청이 너무 큽니다.' });
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000, // 실서버에선 넉넉하게 → 파트가 한 번에 완결됨 (속도도 개선)
        system: String(system || '').slice(0, 8000),
        messages,
      }),
    });

    const data = await r.json();
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: '서버 오류: ' + e.message });
  }
}
