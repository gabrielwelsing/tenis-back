-- ============================================================
-- AGENDA — Horários configurados pelo admin, inscrições dos alunos
-- ============================================================

-- Slots de agenda (blocos de 1h configurados pelo admin)
CREATE TABLE IF NOT EXISTS "agenda_slots" (
    "id"             SERIAL PRIMARY KEY,
    "admin_email"    TEXT NOT NULL,          -- email do admin que criou
    "data"           DATE NOT NULL,
    "hora_inicio"    TIME NOT NULL,
    "hora_fim"       TIME NOT NULL,
    "tipo"           TEXT NOT NULL DEFAULT 'livre',  -- 'individual'|'coletiva'|'bloqueado'
    "vagas"          INTEGER NOT NULL DEFAULT 1,
    "vagas_ocupadas" INTEGER NOT NULL DEFAULT 0,
    "periodicity"    TEXT NOT NULL DEFAULT 'unico',  -- 'unico'|'semana'|'mes'|'3meses'|'sempre'
    "observacao"     TEXT,
    "status"         TEXT NOT NULL DEFAULT 'ativo',  -- 'ativo'|'cancelado'
    "created_at"     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "agenda_slots_admin_data_idx" ON "agenda_slots"("admin_email", "data");

-- Inscrições dos alunos (aguardam confirmação do admin)
CREATE TABLE IF NOT EXISTS "agenda_inscricoes" (
    "id"               SERIAL PRIMARY KEY,
    "slot_id"          INTEGER NOT NULL REFERENCES "agenda_slots"("id") ON DELETE CASCADE,
    "email_aluno"      TEXT NOT NULL,
    "nome_aluno"       TEXT NOT NULL,
    "recorrencia"      TEXT NOT NULL DEFAULT 'unico',
    "confirmado_admin" BOOLEAN NOT NULL DEFAULT FALSE,
    "status"           TEXT NOT NULL DEFAULT 'pendente',  -- 'pendente'|'confirmada'|'cancelada'
    "created_at"       TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE("slot_id", "email_aluno")
);

-- ============================================================
-- QUADRAS — Locais, quadras, disponibilidade, reservas, bloqueios
-- ============================================================

-- Locais (clubes/locais cadastrados pelo admin)
CREATE TABLE IF NOT EXISTS "locais" (
    "id"          SERIAL PRIMARY KEY,
    "admin_email" TEXT NOT NULL,
    "nome"        TEXT NOT NULL,
    "endereco"    TEXT,
    "observacao"  TEXT,
    "socios_only" BOOLEAN NOT NULL DEFAULT FALSE,
    "ativo"       BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at"  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "locais_admin_idx" ON "locais"("admin_email");

-- Quadras dentro de cada local
CREATE TABLE IF NOT EXISTS "quadras" (
    "id"         SERIAL PRIMARY KEY,
    "local_id"   INTEGER NOT NULL REFERENCES "locais"("id") ON DELETE CASCADE,
    "nome"       TEXT NOT NULL,
    "preco_hora" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ativa"      BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "quadras_local_idx" ON "quadras"("local_id");

-- Disponibilidade padrão por quadra (dias e horários)
CREATE TABLE IF NOT EXISTS "quadra_disponibilidade" (
    "id"          SERIAL PRIMARY KEY,
    "quadra_id"   INTEGER NOT NULL REFERENCES "quadras"("id") ON DELETE CASCADE,
    "dias_semana" INTEGER[] NOT NULL,  -- 0=Dom, 1=Seg, ..., 6=Sab
    "hora_inicio" INTEGER NOT NULL,    -- ex: 7 = 07h
    "hora_fim"    INTEGER NOT NULL,    -- ex: 21 = 21h
    "created_at"  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Reservas por hora
CREATE TABLE IF NOT EXISTS "quadra_reservas" (
    "id"           SERIAL PRIMARY KEY,
    "quadra_id"    INTEGER NOT NULL REFERENCES "quadras"("id") ON DELETE CASCADE,
    "email_aluno"  TEXT,
    "nome_reserva" TEXT NOT NULL,
    "whatsapp"     TEXT,
    "data"         DATE NOT NULL,
    "hora"         INTEGER NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'ativa',  -- 'ativa'|'cancelada'|'lista_espera'
    "created_at"   TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE("quadra_id", "data", "hora")
);
CREATE INDEX IF NOT EXISTS "quadra_reservas_quadra_data_idx" ON "quadra_reservas"("quadra_id", "data");

-- Bloqueios pontuais por quadra
CREATE TABLE IF NOT EXISTS "quadra_bloqueios" (
    "id"          SERIAL PRIMARY KEY,
    "quadra_id"   INTEGER NOT NULL REFERENCES "quadras"("id") ON DELETE CASCADE,
    "data"        DATE NOT NULL,
    "hora_inicio" INTEGER NOT NULL,
    "hora_fim"    INTEGER NOT NULL,
    "motivo"      TEXT,
    "created_at"  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "quadra_bloqueios_quadra_data_idx" ON "quadra_bloqueios"("quadra_id", "data");

-- ============================================================
-- DEMO DATA — Exemplos pré-cadastrados para demonstração
-- ============================================================

-- Demo locais (vinculados ao admin demo)
INSERT INTO "locais" ("admin_email","nome","endereco","observacao","socios_only")
VALUES
  ('adm','Automóvel Clube (ACTO)','Rua das Palmeiras, 200 — Teófilo Otoni','5 quadras: 1 coberta + 4 descobertas. Vestiário disponível.',true),
  ('adm','Arena Tênis — Prof. Carlão','Arena Bar — Teófilo Otoni','1 quadra. Disponível somente aos sábados.',false)
ON CONFLICT DO NOTHING;

-- Demo quadras ACTO
INSERT INTO "quadras" ("local_id","nome","preco_hora")
SELECT l.id, q.nome, 0 FROM "locais" l
CROSS JOIN (VALUES ('Coberta'),('Descoberta 1'),('Descoberta 2'),('Descoberta 3'),('Descoberta 4')) AS q(nome)
WHERE l.nome LIKE '%Automóvel%'
ON CONFLICT DO NOTHING;

-- Demo disponibilidade ACTO (todos os dias 07-21)
INSERT INTO "quadra_disponibilidade" ("quadra_id","dias_semana","hora_inicio","hora_fim")
SELECT q.id, ARRAY[0,1,2,3,4,5,6], 7, 21
FROM "quadras" q JOIN "locais" l ON q.local_id = l.id
WHERE l.nome LIKE '%Automóvel%'
ON CONFLICT DO NOTHING;

-- Demo quadra Arena
INSERT INTO "quadras" ("local_id","nome","preco_hora")
SELECT l.id, 'Quadra Principal', 60 FROM "locais" l
WHERE l.nome LIKE '%Arena%'
ON CONFLICT DO NOTHING;

-- Demo disponibilidade Arena (só sábado, 12-21)
INSERT INTO "quadra_disponibilidade" ("quadra_id","dias_semana","hora_inicio","hora_fim")
SELECT q.id, ARRAY[6], 12, 21
FROM "quadras" q JOIN "locais" l ON q.local_id = l.id
WHERE l.nome LIKE '%Arena%'
ON CONFLICT DO NOTHING;
