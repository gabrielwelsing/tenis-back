-- ============================================================
-- DEMO DATA — Exemplos para apresentação a potenciais clientes
-- Usa PL/pgSQL para resolver IDs dinamicamente (idempotente)
-- ============================================================

DO $$
DECLARE
  v_admin_id    INTEGER;
  v_liga_id     UUID;
  v_temp_id     UUID;
  v_carlos_id   INTEGER;
  v_ana_id      INTEGER;
  v_pedro_id    INTEGER;
  v_julia_id    INTEGER;
  v_marcos_id   INTEGER;
  v_beatriz_id  INTEGER;
  v_rafael_id   INTEGER;
  v_camila_id   INTEGER;
BEGIN

  -- Usuários demo (senha hash de 'demo123' — apenas para demonstração)
  INSERT INTO users (nome, email, password_hash, role)
  VALUES ('Admin Demo', 'admin.demo@tenis.com', '$2b$10$demohashdemohashdemoAA', 'admin')
  ON CONFLICT (email) DO NOTHING;
  SELECT id INTO v_admin_id FROM users WHERE email = 'admin.demo@tenis.com';

  INSERT INTO users (nome, email, password_hash, role)
  VALUES ('Carlos Mendes', 'carlos.demo@tenis.com', '$2b$10$demohashdemohashdemo01', 'aluno')
  ON CONFLICT (email) DO NOTHING;
  SELECT id INTO v_carlos_id FROM users WHERE email = 'carlos.demo@tenis.com';

  INSERT INTO users (nome, email, password_hash, role)
  VALUES ('Ana Silva', 'ana.demo@tenis.com', '$2b$10$demohashdemohashdemo02', 'aluno')
  ON CONFLICT (email) DO NOTHING;
  SELECT id INTO v_ana_id FROM users WHERE email = 'ana.demo@tenis.com';

  INSERT INTO users (nome, email, password_hash, role)
  VALUES ('Pedro Costa', 'pedro.demo@tenis.com', '$2b$10$demohashdemohashdemo03', 'aluno')
  ON CONFLICT (email) DO NOTHING;
  SELECT id INTO v_pedro_id FROM users WHERE email = 'pedro.demo@tenis.com';

  INSERT INTO users (nome, email, password_hash, role)
  VALUES ('Julia Rocha', 'julia.demo@tenis.com', '$2b$10$demohashdemohashdemo04', 'aluno')
  ON CONFLICT (email) DO NOTHING;
  SELECT id INTO v_julia_id FROM users WHERE email = 'julia.demo@tenis.com';

  INSERT INTO users (nome, email, password_hash, role)
  VALUES ('Marcos Lima', 'marcos.demo@tenis.com', '$2b$10$demohashdemohashdemo05', 'aluno')
  ON CONFLICT (email) DO NOTHING;
  SELECT id INTO v_marcos_id FROM users WHERE email = 'marcos.demo@tenis.com';

  INSERT INTO users (nome, email, password_hash, role)
  VALUES ('Beatriz Nunes', 'beatriz.demo@tenis.com', '$2b$10$demohashdemohashdemo06', 'aluno')
  ON CONFLICT (email) DO NOTHING;
  SELECT id INTO v_beatriz_id FROM users WHERE email = 'beatriz.demo@tenis.com';

  INSERT INTO users (nome, email, password_hash, role)
  VALUES ('Rafael Dias', 'rafael.demo@tenis.com', '$2b$10$demohashdemohashdemo07', 'aluno')
  ON CONFLICT (email) DO NOTHING;
  SELECT id INTO v_rafael_id FROM users WHERE email = 'rafael.demo@tenis.com';

  INSERT INTO users (nome, email, password_hash, role)
  VALUES ('Camila Ferreira', 'camila.demo@tenis.com', '$2b$10$demohashdemohashdemo08', 'aluno')
  ON CONFLICT (email) DO NOTHING;
  SELECT id INTO v_camila_id FROM users WHERE email = 'camila.demo@tenis.com';

  -- Liga demo
  INSERT INTO ligas (admin_id, nome)
  VALUES (v_admin_id, 'Academia Demo')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_liga_id FROM ligas WHERE admin_id = v_admin_id AND nome = 'Academia Demo' LIMIT 1;

  -- Temporada demo
  INSERT INTO temporadas (liga_id, nome, data_inicio, data_fim, ativa)
  VALUES (v_liga_id, 'Temporada 2026', '2026-01-01', '2026-12-31', true)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_temp_id FROM temporadas WHERE liga_id = v_liga_id AND nome = 'Temporada 2026' LIMIT 1;

  -- Membros (com classe por membro)
  INSERT INTO membros_liga (liga_id, user_id, classe, ativo) VALUES
    (v_liga_id, v_carlos_id,  'avancado',      true),
    (v_liga_id, v_ana_id,     'avancado',      true),
    (v_liga_id, v_pedro_id,   'avancado',      true),
    (v_liga_id, v_julia_id,   'intermediario', true),
    (v_liga_id, v_marcos_id,  'intermediario', true),
    (v_liga_id, v_beatriz_id, 'intermediario', true),
    (v_liga_id, v_rafael_id,  'iniciante',     true),
    (v_liga_id, v_camila_id,  'iniciante',     true)
  ON CONFLICT (liga_id, user_id) DO NOTHING;

  -- Partidas demo — Avançado
  INSERT INTO partidas (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida, vencedor_id, pontos_a, pontos_b, status, confirmado_a, confirmado_b, data_partida)
  SELECT v_temp_id, v_carlos_id, v_ana_id,
    '{"sets":[{"a":6,"b":3},{"a":6,"b":4}]}'::jsonb,
    'liga', v_carlos_id, 10, 1, 'confirmada', true, true, '2026-02-10'
  WHERE NOT EXISTS (SELECT 1 FROM partidas WHERE temporada_id=v_temp_id AND jogador_a_id=v_carlos_id AND jogador_b_id=v_ana_id AND data_partida='2026-02-10');

  INSERT INTO partidas (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida, vencedor_id, pontos_a, pontos_b, bonus_a, status, confirmado_a, confirmado_b, data_partida)
  SELECT v_temp_id, v_carlos_id, v_pedro_id,
    '{"sets":[{"a":6,"b":2},{"a":6,"b":1}]}'::jsonb,
    'liga', v_carlos_id, 13, 0, 3, 'confirmada', true, true, '2026-02-17'
  WHERE NOT EXISTS (SELECT 1 FROM partidas WHERE temporada_id=v_temp_id AND jogador_a_id=v_carlos_id AND jogador_b_id=v_pedro_id AND data_partida='2026-02-17');

  INSERT INTO partidas (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida, vencedor_id, pontos_a, pontos_b, status, confirmado_a, confirmado_b, data_partida)
  SELECT v_temp_id, v_ana_id, v_pedro_id,
    '{"sets":[{"a":7,"b":5},{"a":6,"b":3}]}'::jsonb,
    'liga', v_ana_id, 10, 1, 'confirmada', true, true, '2026-02-20'
  WHERE NOT EXISTS (SELECT 1 FROM partidas WHERE temporada_id=v_temp_id AND jogador_a_id=v_ana_id AND jogador_b_id=v_pedro_id AND data_partida='2026-02-20');

  INSERT INTO partidas (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida, vencedor_id, pontos_a, pontos_b, status, confirmado_a, confirmado_b, data_partida)
  SELECT v_temp_id, v_pedro_id, v_carlos_id,
    '{"sets":[{"a":6,"b":4},{"a":4,"b":6},{"a":7,"b":5}]}'::jsonb,
    'liga', v_pedro_id, 8, 3, 'confirmada', true, true, '2026-03-05'
  WHERE NOT EXISTS (SELECT 1 FROM partidas WHERE temporada_id=v_temp_id AND jogador_a_id=v_pedro_id AND jogador_b_id=v_carlos_id AND data_partida='2026-03-05');

  INSERT INTO partidas (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida, vencedor_id, pontos_a, pontos_b, status, confirmado_a, confirmado_b, data_partida)
  SELECT v_temp_id, v_ana_id, v_carlos_id,
    '{"sets":[{"a":3,"b":6},{"a":6,"b":4},{"a":6,"b":7}]}'::jsonb,
    'liga', v_carlos_id, 3, 8, 'confirmada', true, true, '2026-03-12'
  WHERE NOT EXISTS (SELECT 1 FROM partidas WHERE temporada_id=v_temp_id AND jogador_a_id=v_ana_id AND jogador_b_id=v_carlos_id AND data_partida='2026-03-12');

  -- Partidas demo — Intermediário
  INSERT INTO partidas (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida, vencedor_id, pontos_a, pontos_b, status, confirmado_a, confirmado_b, data_partida)
  SELECT v_temp_id, v_julia_id, v_marcos_id,
    '{"sets":[{"a":6,"b":2},{"a":6,"b":3}]}'::jsonb,
    'liga', v_julia_id, 10, 1, 'confirmada', true, true, '2026-02-12'
  WHERE NOT EXISTS (SELECT 1 FROM partidas WHERE temporada_id=v_temp_id AND jogador_a_id=v_julia_id AND jogador_b_id=v_marcos_id AND data_partida='2026-02-12');

  INSERT INTO partidas (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida, vencedor_id, pontos_a, pontos_b, status, confirmado_a, confirmado_b, data_partida)
  SELECT v_temp_id, v_marcos_id, v_beatriz_id,
    '{"sets":[{"a":6,"b":4},{"a":7,"b":5}]}'::jsonb,
    'liga', v_marcos_id, 10, 1, 'confirmada', true, true, '2026-02-19'
  WHERE NOT EXISTS (SELECT 1 FROM partidas WHERE temporada_id=v_temp_id AND jogador_a_id=v_marcos_id AND jogador_b_id=v_beatriz_id AND data_partida='2026-02-19');

  INSERT INTO partidas (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida, vencedor_id, pontos_a, pontos_b, bonus_a, status, confirmado_a, confirmado_b, data_partida)
  SELECT v_temp_id, v_julia_id, v_beatriz_id,
    '{"sets":[{"a":6,"b":1},{"a":6,"b":0}]}'::jsonb,
    'liga', v_julia_id, 13, 0, 3, 'confirmada', true, true, '2026-02-26'
  WHERE NOT EXISTS (SELECT 1 FROM partidas WHERE temporada_id=v_temp_id AND jogador_a_id=v_julia_id AND jogador_b_id=v_beatriz_id AND data_partida='2026-02-26');

  -- Partidas demo — Iniciante
  INSERT INTO partidas (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida, vencedor_id, pontos_a, pontos_b, status, confirmado_a, confirmado_b, data_partida)
  SELECT v_temp_id, v_rafael_id, v_camila_id,
    '{"sets":[{"a":6,"b":3},{"a":6,"b":4}]}'::jsonb,
    'liga', v_rafael_id, 10, 1, 'confirmada', true, true, '2026-02-14'
  WHERE NOT EXISTS (SELECT 1 FROM partidas WHERE temporada_id=v_temp_id AND jogador_a_id=v_rafael_id AND jogador_b_id=v_camila_id AND data_partida='2026-02-14');

  INSERT INTO partidas (temporada_id, jogador_a_id, jogador_b_id, placar, tipo_partida, vencedor_id, pontos_a, pontos_b, status, confirmado_a, confirmado_b, data_partida)
  SELECT v_temp_id, v_camila_id, v_rafael_id,
    '{"sets":[{"a":7,"b":5},{"a":6,"b":4}]}'::jsonb,
    'liga', v_camila_id, 10, 1, 'confirmada', true, true, '2026-02-21'
  WHERE NOT EXISTS (SELECT 1 FROM partidas WHERE temporada_id=v_temp_id AND jogador_a_id=v_camila_id AND jogador_b_id=v_rafael_id AND data_partida='2026-02-21');

END $$;
