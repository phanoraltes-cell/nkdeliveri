export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          address_line: string
          city: string
          created_at: string
          id: string
          is_default: boolean
          label: string | null
          lat: number | null
          lng: number | null
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address_line: string
          city?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          lat?: number | null
          lng?: number | null
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address_line?: string
          city?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string | null
          lat?: number | null
          lng?: number | null
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          assigned_at: string
          created_at: string
          delivered_at: string | null
          driver_id: string | null
          driver_notes: string | null
          fee: number
          id: string
          order_id: string
          picked_up_at: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          created_at?: string
          delivered_at?: string | null
          driver_id?: string | null
          driver_notes?: string | null
          fee?: number
          id?: string
          order_id: string
          picked_up_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          created_at?: string
          delivered_at?: string | null
          driver_id?: string | null
          driver_notes?: string | null
          fee?: number
          id?: string
          order_id?: string
          picked_up_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          address: string | null
          commission_rate: number
          created_at: string
          current_lat: number | null
          current_lng: number | null
          first_name: string | null
          id: string
          id_doc_url: string | null
          last_name: string | null
          license_doc_url: string | null
          license_plate: string | null
          moncash_number: string | null
          natcash_number: string | null
          payout_frequency: string
          phone: string | null
          status: Database["public"]["Enums"]["driver_status"]
          updated_at: string
          user_id: string
          vehicle_photo_url: string | null
          vehicle_type: string | null
        }
        Insert: {
          address?: string | null
          commission_rate?: number
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          first_name?: string | null
          id?: string
          id_doc_url?: string | null
          last_name?: string | null
          license_doc_url?: string | null
          license_plate?: string | null
          moncash_number?: string | null
          natcash_number?: string | null
          payout_frequency?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
          user_id: string
          vehicle_photo_url?: string | null
          vehicle_type?: string | null
        }
        Update: {
          address?: string | null
          commission_rate?: number
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          first_name?: string | null
          id?: string
          id_doc_url?: string | null
          last_name?: string | null
          license_doc_url?: string | null
          license_plate?: string | null
          moncash_number?: string | null
          natcash_number?: string | null
          payout_frequency?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
          user_id?: string
          vehicle_photo_url?: string | null
          vehicle_type?: string | null
        }
        Relationships: []
      }
      menu_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          data: Json
          id: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          line_total: number
          notes: string | null
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total: number
          notes?: string | null
          order_id: string
          product_id?: string | null
          product_name: string
          quantity: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total?: number
          notes?: string | null
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address_id: string | null
          contact_phone: string | null
          created_at: string
          currency: string
          customer_id: string
          delivery_address: string
          delivery_fee: number
          delivery_notes: string | null
          id: string
          order_number: string
          restaurant_id: string
          service_fee: number
          status: Database["public"]["Enums"]["order_status"]
          status_history: Json
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          address_id?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          customer_id: string
          delivery_address: string
          delivery_fee?: number
          delivery_notes?: string | null
          id?: string
          order_number?: string
          restaurant_id: string
          service_fee?: number
          status?: Database["public"]["Enums"]["order_status"]
          status_history?: Json
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          address_id?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          delivery_address?: string
          delivery_fee?: number
          delivery_notes?: string | null
          id?: string
          order_number?: string
          restaurant_id?: string
          service_fee?: number
          status?: Database["public"]["Enums"]["order_status"]
          status_history?: Json
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_proofs: {
        Row: {
          created_at: string
          file_url: string
          id: string
          notes: string | null
          payment_id: string
          sender_phone: string | null
          transaction_ref: string | null
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_url: string
          id?: string
          notes?: string | null
          payment_id: string
          sender_phone?: string | null
          transaction_ref?: string | null
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_url?: string
          id?: string
          notes?: string | null
          payment_id?: string
          sender_phone?: string | null
          transaction_ref?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_proofs_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          receiver_account_name: string | null
          receiver_number: string | null
          receiver_restaurant_id: string | null
          receiver_type: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sender_name: string | null
          sender_phone: string | null
          status: Database["public"]["Enums"]["payment_status"]
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          transaction_ref: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          receiver_account_name?: string | null
          receiver_number?: string | null
          receiver_restaurant_id?: string | null
          receiver_type?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender_name?: string | null
          sender_phone?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          transaction_ref?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          order_id?: string
          receiver_account_name?: string | null
          receiver_number?: string | null
          receiver_restaurant_id?: string | null
          receiver_type?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sender_name?: string | null
          sender_phone?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          transaction_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_receiver_restaurant_id_fkey"
            columns: ["receiver_restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          available: boolean
          category_id: string | null
          created_at: string
          description: string | null
          dish_type: string | null
          id: string
          image_url: string | null
          name: string
          popular: boolean
          price: number
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          available?: boolean
          category_id?: string | null
          created_at?: string
          description?: string | null
          dish_type?: string | null
          id?: string
          image_url?: string | null
          name: string
          popular?: boolean
          price: number
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          available?: boolean
          category_id?: string | null
          created_at?: string
          description?: string | null
          dish_type?: string | null
          id?: string
          image_url?: string | null
          name?: string
          popular?: boolean
          price?: number
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          created_at: string
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string
          first_name?: string | null
          id: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      restaurant_employees: {
        Row: {
          created_at: string
          id: string
          restaurant_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          restaurant_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          restaurant_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_employees_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          address: string | null
          avg_prep_time: number
          commission_rate: number
          commission_type: string
          cover_url: string | null
          created_at: string
          cuisine: string | null
          delivery_fee: number
          description: string | null
          id: string
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          min_order: number
          moncash_account_name: string | null
          moncash_number: string | null
          monthly_commission_amount: number
          name: string
          natcash_account_name: string | null
          natcash_number: string | null
          opening_hours: Json | null
          owner_id: string | null
          payout_mode: string
          phone: string | null
          rating: number | null
          slug: string
          status: Database["public"]["Enums"]["restaurant_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          avg_prep_time?: number
          commission_rate?: number
          commission_type?: string
          cover_url?: string | null
          created_at?: string
          cuisine?: string | null
          delivery_fee?: number
          description?: string | null
          id?: string
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          min_order?: number
          moncash_account_name?: string | null
          moncash_number?: string | null
          monthly_commission_amount?: number
          name: string
          natcash_account_name?: string | null
          natcash_number?: string | null
          opening_hours?: Json | null
          owner_id?: string | null
          payout_mode?: string
          phone?: string | null
          rating?: number | null
          slug: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          avg_prep_time?: number
          commission_rate?: number
          commission_type?: string
          cover_url?: string | null
          created_at?: string
          cuisine?: string | null
          delivery_fee?: number
          description?: string | null
          id?: string
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          min_order?: number
          moncash_account_name?: string | null
          moncash_number?: string | null
          monthly_commission_amount?: number
          name?: string
          natcash_account_name?: string | null
          natcash_number?: string | null
          opening_hours?: Json | null
          owner_id?: string | null
          payout_mode?: string
          phone?: string | null
          rating?: number | null
          slug?: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string
          customer_id: string
          driver_id: string | null
          driver_rating: number | null
          id: string
          order_id: string
          restaurant_id: string | null
          restaurant_rating: number | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          customer_id: string
          driver_id?: string | null
          driver_rating?: number | null
          id?: string
          order_id: string
          restaurant_id?: string | null
          restaurant_rating?: number | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          customer_id?: string
          driver_id?: string | null
          driver_rating?: number | null
          id?: string
          order_id?: string
          restaurant_id?: string | null
          restaurant_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_primary_role: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "customer"
        | "restaurant_owner"
        | "restaurant_staff"
        | "driver"
        | "admin"
        | "super_admin"
      delivery_status:
        | "assigned"
        | "en_route_pickup"
        | "picked_up"
        | "en_route_dropoff"
        | "delivered"
        | "cancelled"
      driver_status:
        | "pending"
        | "approved"
        | "suspended"
        | "rejected"
        | "offline"
        | "online"
      order_status:
        | "pending"
        | "confirmed"
        | "preparing"
        | "ready"
        | "assigned"
        | "picked_up"
        | "delivered"
        | "cancelled"
        | "refunded"
      payment_method: "stripe" | "moncash" | "natcash" | "kach"
      payment_status:
        | "pending"
        | "awaiting_proof"
        | "under_review"
        | "paid"
        | "failed"
        | "refunded"
      restaurant_status: "pending" | "approved" | "suspended" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "customer",
        "restaurant_owner",
        "restaurant_staff",
        "driver",
        "admin",
        "super_admin",
      ],
      delivery_status: [
        "assigned",
        "en_route_pickup",
        "picked_up",
        "en_route_dropoff",
        "delivered",
        "cancelled",
      ],
      driver_status: [
        "pending",
        "approved",
        "suspended",
        "rejected",
        "offline",
        "online",
      ],
      order_status: [
        "pending",
        "confirmed",
        "preparing",
        "ready",
        "assigned",
        "picked_up",
        "delivered",
        "cancelled",
        "refunded",
      ],
      payment_method: ["stripe", "moncash", "natcash", "kach"],
      payment_status: [
        "pending",
        "awaiting_proof",
        "under_review",
        "paid",
        "failed",
        "refunded",
      ],
      restaurant_status: ["pending", "approved", "suspended", "rejected"],
    },
  },
} as const
