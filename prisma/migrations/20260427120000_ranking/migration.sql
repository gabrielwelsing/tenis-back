-- ============================================================
-- RANKING — Ligas, Temporadas, Partidas, Desafios
-- ============================================================

CREATE TABLE IF NOT EXISTS "ligas" (
  "id"         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "admin_id"   INTEGER     NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "nome"       TEXT        NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "ligas_admin_idx" ON "ligas"("admin_id");

CREATE TABLE IF NOT EXISTS "membros_liga" (
  "id"         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "liga_id"    UUID        NOT NULL REFERENCES "ligas"("id") ON DELETE CASCADE,
  "user_id"    INTEGER     NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "classe"     TEXT        NOT NULL DEFAULT 'intermediario',
  "ativo"      BOOLEAN     NOT NULL DEFAULT TRUE,
  "entrada_em" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("liga_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "membros_liga_liga_idx" ON "membros_liga"("liga_id");
CREATE INDEX IF NOT EXISTS "membros_liga_user_idx" ON "membros_liga"("user_id");

CREATE TABLE IF NOT EXISTS "temporadas" (
  "id"          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "liga_id"     UUID        NOT NULL REFERENCES "ligas"("id") ON DELETE CASCADE,
  "nome"        TEXT        NOT NULL,
  "data_inicio" DATE        NOT NULL,
  "data_fim"    DATE        NOT NULL,
  "ativa"       BOOLEAN     NOT NULL DEFAULT TRUE,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "temporadas_liga_idx" ON "temporadas"("liga_id");

CREATE TABLE IF NOT EXISTS "partidas" (
  "id"           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "temporada_id" UUID        NOT NULL REFERENCES "temporadas"("id") ON DELETE CASCADE,
  "jogador_a_id" INTEGER     NOT NULL REFERENCES "users"("id"),
  "jogador_b_id" INTEGER     NOT NULL REFERENCES "users"("id"),
  "placar"       JSONB,
  "tipo_partida" TEXT        NOT NULL,
  "vencedor_id"  INTEGER     REFERENCES "users"("id"),
  "wo"           BOOLEAN     NOT NULL DEFAULT FALSE,
  "pontos_a"     INTEGER     NOT NULL DEFAULT 0,
  "pontos_b"     INTEGER     NOT NULL DEFAULT 0,
  "bonus_a"      INTEGER     NOT NULL DEFAULT 0,
  "bonus_b"      INTEGER     NOT NULL DEFAULT 0,
  "status"       TEXT        NOT NULL DEFAULT 'pendente',
  "data_partida" DATE        NOT NULL,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "partidas_temporada_idx" ON "partidas"("temporada_id");
CREATE INDEX IF NOT EXISTS "partidas_jogadores_idx" ON "partidas"("jogador_a_id", "jogador_b_id");

CREATE TABLE IF NOT EXISTS "desafios" (
  "id"               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "liga_id"          UUID        NOT NULL REFERENCES "ligas"("id") ON DELETE CASCADE,
  "desafiante_id"    INTEGER     NOT NULL REFERENCES "users"("id"),
  "desafiado_id"     INTEGER     NOT NULL REFERENCES "users"("id"),
  "data_sugerida"    TEXT        NOT NULL,
  "horario_sugerido" TEXT        NOT NULL,
  "local_sugerido"   TEXT        NOT NULL,
  "status"           TEXT        NOT NULL DEFAULT 'pendente',
  "contra_data"      TEXT,
  "contra_horario"   TEXT,
  "contra_local"     TEXT,
  "partida_id"       UUID        REFERENCES "partidas"("id"),
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "desafios_liga_idx" ON "desafios"("liga_id");
