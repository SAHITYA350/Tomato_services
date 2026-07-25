import type { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";

export interface IUser {
  _id: string;
  name: string;
  email: string;
  image?: string;
  role?: string | null;
  restaurantId?: string;
}

export type AuthenticatedRequest = Request & {
  user?: IUser | null;
};

export const isAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ message: "Please Login - No token provided" });
      return;
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
      res.status(401).json({ message: "Please Login - Token missing" });
      return;
    }
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "supersecretjwtkeyforzomatoclone2026"
    ) as JwtPayload;

    if (!decoded || !decoded.user) {
      res.status(401).json({ message: "Please Login - Invalid token" });
      return;
    }

    req.user = decoded.user as IUser;
    next();
  } catch (error) {
    res.status(401).json({ message: "Please Login - Token expired or invalid" });
  }
};

export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      if (token) {
        const decoded = jwt.verify(
          token,
          process.env.JWT_SECRET || "supersecretjwtkeyforzomatoclone2026"
        ) as JwtPayload;
        if (decoded && decoded.user) {
          req.user = decoded.user as IUser;
        }
      }
    }
  } catch (e) {
    // Ignore optional auth errors
  }
  next();
};
