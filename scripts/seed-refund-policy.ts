import "dotenv/config";

import { prisma } from "@/lib/prisma";

async function main() {
  const business = await prisma.business.findUnique({
    where: {
      id: "cmsni1uij0000ewvwjzoenugh",
    },

    select: {
      id: true,
      name: true,
      slug: true,
    },
  });

  if (!business) {
    throw new Error("BUSINESS_NOT_FOUND");
  }

  const existingPolicy = await prisma.refundPolicy.findFirst({
    where: {
      businessId: business.id,
      isActive: true,
    },

    orderBy: {
      effectiveFrom: "desc",
    },
  });

  if (existingPolicy) {
    console.log("Ya existe una política activa:");
    console.log({
      id: existingPolicy.id,
      business: business.name,
      name: existingPolicy.name,
      fullRefundDays: existingPolicy.fullRefundDays,
      annualAdministrativeRate: Number(existingPolicy.annualAdministrativeRate),
      effectiveFrom: existingPolicy.effectiveFrom,
    });

    return;
  }

  const policy = await prisma.refundPolicy.create({
    data: {
      businessId: business.id,

      name: "Política base El Salvador",

      /*
       * Decisión comercial:
       * devolución íntegra durante
       * los primeros 8 días.
       */
      fullRefundDays: 8,

      /*
       * 12% anual expresado como decimal.
       *
       * El valor queda en DB y además
       * será copiado como snapshot
       * en cada Refund.
       */
      annualAdministrativeRate: 0.12,

      effectiveFrom: new Date(),

      isActive: true,
    },
  });

  console.log("✅ Política de reembolso creada");

  console.log({
    id: policy.id,
    business: business.name,
    name: policy.name,
    fullRefundDays: policy.fullRefundDays,
    annualAdministrativeRate: Number(policy.annualAdministrativeRate),
    effectiveFrom: policy.effectiveFrom,
    isActive: policy.isActive,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
