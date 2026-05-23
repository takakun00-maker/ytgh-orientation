const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPass(pass) {
  return crypto.createHash('sha256').update(pass).digest('hex');
}

const ok  = (data, code=200) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const err = (msg,  code=400) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) });

async function getSession(event) {
  const auth  = event.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const { data } = await supabase
    .from('sessions').select('*').eq('token', token)
    .gt('expires_at', new Date().toISOString()).single();
  return data || null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const path   = event.path.replace('/.netlify/functions/api', '').replace('/api', '');
  const method = event.httpMethod;
  const body   = event.body ? JSON.parse(event.body) : {};

  if (path === '/auth/hospital' && method === 'POST') {
    const { username, password } = body;
    const hash = hashPass(password);
    const { data: staff } = await supabase.from('hospital_staff')
      .select('id,username,display_name,role')
      .eq('username', username).eq('password_hash', hash).single();
    if (!staff) return err('ユーザー名またはパスワードが間違っています', 401);
    const token     = genToken();
    const expiresAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
    await supabase.from('sessions').insert({ token, user_id: staff.id, user_type: 'hospital', expires_at: expiresAt });
    return ok({ token, user: staff });
  }

  if (path === '/auth/vendor' && method === 'POST') {
    const { login_code } = body;
    const { data: vendor } = await supabase.from('vendors')
      .select('id,name,company,device,tel,email')
      .eq('login_code', login_code.toUpperCase().trim()).single();
    if (!vendor) return err('ログインコードが正しくありません', 401);
    const token     = genToken();
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await supabase.from('sessions').insert({ token, user_id: vendor.id, user_type: 'vendor', expires_at: expiresAt });
    return ok({ token, vendor });
  }

  if (path === '/auth/logout' && method === 'POST') {
    const session = await getSession(event);
    if (session) await supabase.from('sessions').delete().eq('token', session.token);
    return ok({ ok: true });
  }

  const session = await getSession(event);
  if (!session) return err('認証が必要です', 401);

  const isHospital = session.user_type === 'hospital';
  const isVendor   = session.user_type === 'vendor';

  if (path === '/me' && method === 'GET') {
    if (isHospital) {
      const { data } = await supabase.from('hospital_staff')
        .select('id,username,display_name,role').eq('id', session.user_id).single();
      return ok({ type: 'hospital', ...data });
    }
    const { data } = await supabase.from('vendors')
      .select('id,name,company,device,tel').eq('id', session.user_id).single();
    return ok({ type: 'vendor', ...data });
  }

  if (isHospital) {
    if (path === '/vendors' && method === 'GET') {
      const { data, error } = await supabase.from('vendors')
        .select('*, orientation_records(id,date,expiry,test_pass,pledge_signed,pledge_only,created_at)')
        .order('company');
      if (error) return err(error.message);
      return ok(data);
    }
    if (path === '/vendors' && method === 'POST') {
      const code = Math.random().toString(36).slice(2,8).toUpperCase();
      const { data, error } = await supabase.from('vendors')
        .insert({ ...body, login_code: code }).select().single();
      if (error) return err(error.message);
      return ok(data, 201);
    }
    if (path.match(/^\/vendors\/[a-zA-Z0-9-]+$/) && method === 'PUT') {
      const id = path.split('/')[2];
      const { data, error } = await supabase.from('vendors').update(body).eq('id', id).select().single();
      if (error) return err(error.message);
      return ok(data);
    }
    if (path.match(/^\/vendors\/[a-zA-Z0-9-]+$/) && method === 'DELETE') {
      const id = path.split('/')[2];
      await supabase.from('vendors').delete().eq('id', id);
      return ok({ ok: true });
    }
    if (path === '/records' && method === 'GET') {
      const { data, error } = await supabase.from('orientation_records')
        .select('*, vendors(name,company,device)')
        .order('created_at', { ascending: false }).limit(200);
      if (error) return err(error.message);
      return ok(data);
    }
    if (path.match(/^\/vendors\/[a-zA-Z0-9-]+\/records$/) && method === 'GET') {
      const id = path.split('/')[2];
      const { data, error } = await supabase.from('orientation_records')
        .select('*').eq('vendor_id', id).order('created_at', { ascending: false });
      if (error) return err(error.message);
      return ok(data);
    }
    if (path.match(/^\/vendors\/[a-zA-Z0-9-]+\/reset-code$/) && method === 'POST') {
      const id   = path.split('/')[2];
      const code = Math.random().toString(36).slice(2,8).toUpperCase();
      await supabase.from('vendors').update({ login_code: code }).eq('id', id);
      return ok({ login_code: code });
    }
    if (path === '/dashboard' && method === 'GET') {
      const { data: vendors } = await supabase.from('vendors').select('id');
      const { data: records } = await supabase.from('orientation_records')
        .select('vendor_id,expiry,test_pass,pledge_only')
        .eq('test_pass', true).eq('pledge_only', false);
      const today = new Date();
      const vendorMap = {};
      (records || []).forEach(r => {
        const dl = Math.floor((new Date(r.expiry) - today) / 86400000);
        if (!vendorMap[r.vendor_id] || new Date(vendorMap[r.vendor_id].expiry) < new Date(r.expiry))
          vendorMap[r.vendor_id] = { expiry: r.expiry, daysLeft: dl };
      });
      const stats = { total: vendors?.length || 0, ok: 0, warn: 0, ng: 0 };
      Object.values(vendorMap).forEach(v => {
        if (v.daysLeft > 30) stats.ok++;
        else if (v.daysLeft >= 0) stats.warn++;
        else stats.ng++;
      });
      stats.ng += stats.total - stats.ok - stats.warn - Object.keys(vendorMap).length;
      return ok(stats);
    }
    if (path === '/staff' && method === 'GET') {
      const { data: me } = await supabase.from('hospital_staff').select('role').eq('id', session.user_id).single();
      if (me?.role !== 'admin') return err('管理者権限が必要です', 403);
      const { data, error } = await supabase.from('hospital_staff')
        .select('id,username,display_name,role,created_at').order('created_at');
      if (error) return err(error.message);
      return ok(data);
    }
    if (path === '/staff' && method === 'POST') {
      const { data: me } = await supabase.from('hospital_staff').select('role').eq('id', session.user_id).single();
      if (me?.role !== 'admin') return err('管理者権限が必要です', 403);
      const { username, display_name, password, role } = body;
      if (!username || !password) return err('ユーザー名とパスワードは必須です');
      const { data, error } = await supabase.from('hospital_staff')
        .insert({ username, display_name, password_hash: hashPass(password), role: role || 'staff' })
        .select('id,username,display_name,role').single();
      if (error) return err(error.message);
      return ok(data, 201);
    }
    if (path.match(/^\/staff\/[a-zA-Z0-9-]+$/) && method === 'DELETE') {
      const { data: me } = await supabase.from('hospital_staff').select('role').eq('id', session.user_id).single();
      if (me?.role !== 'admin') return err('管理者権限が必要です', 403);
      const id = path.split('/')[2];
      if (id === session.user_id) return err('自分自身は削除できません', 400);
      await supabase.from('hospital_staff').delete().eq('id', id);
      return ok({ ok: true });
    }
    return err('Not found', 404);
  }

  if (isVendor) {
    const vendorId = session.user_id;
    if (path === '/my/status' && method === 'GET') {
      const { data: vendor } = await supabase.from('vendors').select('*').eq('id', vendorId).single();
      const { data: records } = await supabase.from('orientation_records')
        .select('*').eq('vendor_id', vendorId).order('created_at', { ascending: false }).limit(5);
      return ok({ vendor, records: records || [] });
    }
    if (path === '/my/watch' && method === 'POST') {
      const { chapter, record_id } = body;
      const col = `watched_${chapter}`;
      if (!['safety','infection','facility','privacy'].includes(chapter)) return err('invalid chapter');
      if (record_id) {
        await supabase.from('orientation_records').update({ [col]: true }).eq('id', record_id).eq('vendor_id', vendorId);
        return ok({ ok: true });
      }
      const today  = new Date().toISOString().slice(0,10);
      const expiry = new Date(new Date().setFullYear(new Date().getFullYear()+1)).toISOString().slice(0,10);
      const { data: existing } = await supabase.from('orientation_records')
        .select('id').eq('vendor_id', vendorId).eq('date', today).eq('test_pass', false).maybeSingle();
      if (existing) {
        await supabase.from('orientation_records').update({ [col]: true }).eq('id', existing.id);
        return ok({ record_id: existing.id });
      }
      const { data: rec } = await supabase.from('orientation_records')
        .insert({ vendor_id: vendorId, date: today, expiry, [col]: true }).select().single();
      return ok({ record_id: rec.id });
    }
    if (path === '/my/pledge' && method === 'POST') {
      const { name, company, sig_image, record_id } = body;
      const pledgeData = {
        pledge_signed: true, pledge_name: name, pledge_company: company,
        pledge_signed_at: new Date().toISOString(), pledge_sig_image: sig_image,
      };
      if (record_id) {
        await supabase.from('orientation_records').update(pledgeData).eq('id', record_id).eq('vendor_id', vendorId);
        return ok({ ok: true });
      }
      const today  = new Date().toISOString().slice(0,10);
      const expiry = new Date(new Date().setFullYear(new Date().getFullYear()+1)).toISOString().slice(0,10);
      const { data } = await supabase.from('orientation_records')
        .insert({ vendor_id: vendorId, date: today, expiry, pledge_only: true, ...pledgeData })
        .select().single();
      return ok({ record_id: data.id });
    }
    if (path === '/my/checklist' && method === 'POST') {
      const { checklist, record_id } = body;
      if (record_id) {
        await supabase.from('orientation_records').update({ checklist }).eq('id', record_id).eq('vendor_id', vendorId);
      }
      return ok({ ok: true });
    }
    if (path === '/my/test' && method === 'POST') {
      const { scores, record_id, staff_name } = body;
      const pass   = scores.filter(Boolean).length >= 4;
      const today  = new Date().toISOString().slice(0,10);
      const expiry = new Date(new Date().setFullYear(new Date().getFullYear()+1)).toISOString().slice(0,10);
      if (record_id) {
        await supabase.from('orientation_records')
          .update({ test_scores: scores, test_pass: pass, expiry, staff_name })
          .eq('id', record_id).eq('vendor_id', vendorId);
        return ok({ pass, expiry });
      }
      const { data } = await supabase.from('orientation_records')
        .insert({ vendor_id: vendorId, date: today, expiry, test_scores: scores, test_pass: pass, staff_name })
        .select().single();
      return ok({ pass, expiry, record_id: data.id });
    }
    return err('Not found', 404);
  }

  return err('Not found', 404);
};
