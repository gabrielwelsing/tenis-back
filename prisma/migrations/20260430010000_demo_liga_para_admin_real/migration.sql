-- ============================================================
-- Transfere a liga demo para o primeiro admin real do sistema
-- e adiciona todos os admins/alunos reais como membros,
-- para que o professor veja os dados demo ao abrir o Ranking.
-- ============================================================

DO $$
DECLARE
  v_real_admin_id INTEGER;
  v_liga_id       UUID;
BEGIN

  -- Primeiro admin real (não é o admin.demo)
  SELECT id INTO v_real_admin_id
  FROM users
  WHERE role = 'admin'
    AND email NOT LIKE '%.demo@tenis.com'
  ORDER BY id
  LIMIT 1;

  IF v_real_admin_id IS NULL THEN
    RETURN; -- nenhum admin real cadastrado ainda, pula
  END IF;

  -- ID da liga demo
  SELECT id INTO v_liga_id
  FROM ligas
  WHERE nome = 'Academia Demo'
  LIMIT 1;

  IF v_liga_id IS NULL THEN
    RETURN; -- liga demo não existe, pula
  END IF;

  -- Transfere propriedade da liga para o admin real
  UPDATE ligas SET admin_id = v_real_admin_id WHERE id = v_liga_id;

  -- Adiciona o admin real como membro (avançado) para aparecer no ranking demo
  INSERT INTO membros_liga (liga_id, user_id, classe, ativo)
  VALUES (v_liga_id, v_real_admin_id, 'avancado', true)
  ON CONFLICT (liga_id, user_id) DO UPDATE SET ativo = true;

  -- Adiciona todos os outros admins/alunos reais como membros também
  INSERT INTO membros_liga (liga_id, user_id, classe, ativo)
  SELECT v_liga_id, u.id, 'avancado', true
  FROM users u
  WHERE u.role IN ('admin', 'aluno')
    AND u.email NOT LIKE '%.demo@tenis.com'
    AND u.id != v_real_admin_id
  ON CONFLICT (liga_id, user_id) DO UPDATE SET ativo = true;

END $$;
