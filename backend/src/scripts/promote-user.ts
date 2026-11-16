import { pool } from "../db";
import { ROLES } from "../modules/auth/middleware";

/**
 * `npm run user:promote -- email@exemplo.com [papel]`
 *
 * Define o papel de uma conta direto no banco (padrão: admin). É o caminho para criar o
 * PRIMEIRO admin de uma instalação nova — o cadastro pela tela nunca concede admin, e as
 * demais promoções podem ser feitas por um admin no painel de administração.
 */
async function main() {
  const [email, role = "admin"] = process.argv.slice(2);
  if (!email) {
    console.error("Uso: npm run user:promote -- email@exemplo.com [dev|analista_suporte|analista_ativacao|admin]");
    process.exit(1);
  }
  if (!(ROLES as readonly string[]).includes(role)) {
    console.error(`Papel inválido: ${role}. Use um de: ${ROLES.join(", ")}`);
    process.exit(1);
  }
  const { rows } = await pool.query(
    `UPDATE users SET role = $1, is_active = true, updated_at = now() WHERE email = $2 RETURNING name, email, role`,
    [role, email.toLowerCase()]
  );
  if (!rows[0]) {
    console.error(`Nenhuma conta encontrada com o email ${email}. A pessoa precisa se cadastrar primeiro.`);
    process.exit(1);
  }
  console.log(`${rows[0].name} (${rows[0].email}) agora tem o papel "${rows[0].role}".`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
