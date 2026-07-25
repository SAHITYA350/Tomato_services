export interface ActiveUser {
    id: string;
    type: "rider" | "seller" | "customer";
    name: string;
    lat: number;
    lng: number;
    status: string;
    timestamp: number;
}

export const activeUsers = new Map<string, ActiveUser>();
