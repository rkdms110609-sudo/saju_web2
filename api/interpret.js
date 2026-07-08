// Vercel 서버리스 함수 v2: Anthropic 중계 + Lemon Squeezy 라이선스 검증
// [환경변수]
//  ANTHROPIC_API_KEY : 필수. Anthropic API 키
//  ACCESS_CODE       : 선택. 사이트 전체 접속 코드 (?code=)
//  LICENSED          : 선택. 이용권이 필요한 상품 목록 (예: "newyear,love,saju")
//                      비어있으면 전 상품 무료 → 유료화는 여기에 상품id 추가 + 재배포만 하면 켜짐
//  LS_STORE_ID       : 선택(강력 권장). 내 레몬스퀴지 스토어 ID (남의 스토어 키 차단)
//  LSPROD_NEWYEAR 등 : 선택. 상품별 레몬스퀴지 product_id 바인딩 (다른 상품 키 교차사용 차단)
//  BUY_NEWYEAR 등    : 선택. 상품별 구매 링크 (키 없을 때 안내에 표시)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const requiredCode = process.env.ACCESS_CODE;
  if (requiredCode && req.headers['x-access-code'] !== requiredCode) {
    return res.status(401).json({ error: '접속 코드가 올바르지 않습니다. 공유받은 링크 주소 전체를 그대로 열어주세요.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다.' });
  }

  try {
    const { system, messages, mode } = req.body || {};

    // ===== 이용권(라이선스) 검증 =====
    const product = String(req.headers['x-product'] || '').toLowerCase().replace(/[^a-z]/g, '');
    const licensed = (process.env.LICENSED || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    if (product && licensed.includes(product)) {
      const key = String(req.headers['x-license'] || '').trim();
      const buyUrl = process.env['BUY_' + product.toUpperCase()] || null;
      if (!key) {
        return res.status(402).json({ error: '이 리포트는 이용권이 필요해요. 구매 후 이메일로 받은 라이선스 키를 입력해주세요.', buyUrl });
      }
      // 잠금해제(mode=unlock)는 사용 1회 차감(activate), 이후 파트 생성은 유효성 확인(validate)만
      const endpoint = mode === 'unlock' ? 'activate' : 'validate';
      const form = new URLSearchParams({ license_key: key });
      if (endpoint === 'activate') form.set('instance_name', 'saju-' + Date.now());
      const lr = await fetch('https://api.lemonsqueezy.com/v1/licenses/' + endpoint, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const ld = await lr.json();
      const ok = ld.valid === true || ld.activated === true;
      if (!ok) {
        return res.status(402).json({ error: '라이선스 키가 유효하지 않거나 사용 한도를 넘었어요. (' + (ld.error || '확인 실패') + ')', buyUrl });
      }
      const meta = ld.meta || {};
      if (process.env.LS_STORE_ID && String(meta.store_id) !== String(process.env.LS_STORE_ID)) {
        return res.status(402).json({ error: '이 사이트의 이용권이 아니에요.', buyUrl });
      }
      const bind = process.env['LSPROD_' + product.toUpperCase()];
      if (bind && String(meta.product_id) !== String(bind)) {
        return res.status(402).json({ error: '이 이용권은 다른 리포트용이에요. 상품에 맞는 키를 입력해주세요.', buyUrl });
      }
      if (mode === 'unlock') return res.status(200).json({ unlocked: true });
    } else if (mode === 'unlock') {
      return res.status(200).json({ unlocked: true }); // 무료 상품은 즉시 통과
    }

    // ===== Anthropic 중계 =====
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
      return res.status(400).json({ error: '잘못된 요청 형식입니다.' });
    }
    if (JSON.stringify(messages).length > 60000) {
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
        max_tokens: 3000,
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
