import "server-only";

import type { UserRole } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export type BusinessAccess = {
  user: {
    id: string;
    name: string;
    email: string;
  };

  business: {
    id: string;
    name: string;
  };

  role: UserRole;
};

export type AuthorizationErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "BUSINESS_ACCESS_DENIED"
  | "ROLE_NOT_ALLOWED"
  | "AUTHORIZATION_UNAVAILABLE";

export class AuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    public readonly code: AuthorizationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * El negocio solicitado siempre se comprueba contra una membresía real.
 * allowedRoles debe definirse en código del servidor, nunca desde el cliente.
 * No se comparten sesiones ni resultados entre solicitudes.
 */
export async function requireBusinessAccess(
  businessId: string,
  allowedRoles?: readonly UserRole[],
): Promise<BusinessAccess> {
  try {
    const supabase = await createClient();

    const { data, error } =
      await supabase.auth.getUser();

    if (error) {
      if (
        error.status === 400 ||
        error.status === 401 ||
        error.status === 403
      ) {
        throw new AuthorizationError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Inicia sesión para continuar.",
        );
      }

      throw new AuthorizationError(
        503,
        "AUTHORIZATION_UNAVAILABLE",
        "No fue posible validar el acceso en este momento.",
      );
    }

    if (!data.user) {
      throw new AuthorizationError(
        401,
        "AUTHENTICATION_REQUIRED",
        "Inicia sesión para continuar.",
      );
    }

    if (
      typeof businessId !== "string" ||
      businessId.trim().length === 0
    ) {
      throw new AuthorizationError(
        403,
        "BUSINESS_ACCESS_DENIED",
        "No tienes acceso activo a este negocio.",
      );
    }

    const membership =
      await prisma.businessMembership.findFirst({
        where: {
          businessId,
          isActive: true,

          user: {
            is: {
              authUserId: data.user.id,
              isActive: true,
            },
          },

          business: {
            is: {
              isActive: true,
            },
          },
        },

        select: {
          role: true,

          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },

          business: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

    if (!membership) {
      throw new AuthorizationError(
        403,
        "BUSINESS_ACCESS_DENIED",
        "No tienes acceso activo a este negocio.",
      );
    }

    if (
      allowedRoles !== undefined &&
      !allowedRoles.includes(membership.role)
    ) {
      throw new AuthorizationError(
        403,
        "ROLE_NOT_ALLOWED",
        "Tu rol no permite realizar esta operación.",
      );
    }

    return {
      // Este es User.id, el identificador usado por la auditoría.
      user: membership.user,
      business: membership.business,
      role: membership.role,
    };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      throw error;
    }

    // Un fallo de infraestructura nunca concede acceso.
    // No exponemos errores internos, credenciales ni tokens.
    throw new AuthorizationError(
      503,
      "AUTHORIZATION_UNAVAILABLE",
      "No fue posible validar el acceso en este momento.",
    );
  }
}
