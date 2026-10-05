-- Contas criadas pelo professor: login por usuário + senha provisória.
-- No primeiro acesso o aluno define a própria senha e vincula o e-mail.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS username        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS primeiro_acesso BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS criado_por      INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (LOWER(username));
