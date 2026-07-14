export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      addresses: {
        Row: {
          address_line: string;
          city: string;
          created_at: string;
          id: string;
          is_default: boolean;
          label: string | null;
          lat: number | null;
          lng: number | null;
          notes: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          address_line: string;
          city?: string;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          label?: string | null;
          lat?: number | null;
          lng?: number | null;
          notes?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          address_line?: string;
          city?: string;
          created_at?: string;
          id?: string;
          is_default?: boolean;
          label?: string | null;
          lat?: number | null;
          lng?: number | null;
          notes?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      deliveries: {
        Row: {
          assigned_at: string;
          created_at: string;
          delivered_at: string | null;
          driver_heading: number | null;
          driver_id: string | null;
          driver_lat: number | null;
          driver_lng: number | null;
          driver_notes: string | null;
          fee: number;
          id: string;
          location_updated_at: string | null;
          order_id: string;
          picked_up_at: string | null;
          status: Database["public"]["Enums"]["delivery_status"];
          updated_at: string;
        };
        Insert: {
          assigned_at?: string;
          created_at?: string;
          delivered_at?: string | null;
          driver_heading?: number | null;
          driver_id?: string | null;
          driver_lat?: number | null;
          driver_lng?: number | null;
          driver_notes?: string | null;
          fee?: number;
          id?: string;
          location_updated_at?: string | null;
          order_id: string;
          picked_up_at?: string | null;
          status?: Database["public"]["Enums"]["delivery_status"];
          updated_at?: string;
        };
        Update: {
          assigned_at?: string;
          created_at?: string;
          delivered_at?: string | null;
          driver_heading?: number | null;
          driver_id?: string | null;
          driver_lat?: number | null;
          driver_lng?: number | null;
          driver_notes?: string | null;
          fee?: number;
          id?: string;
          location_updated_at?: string | null;
          order_id?: string;
          picked_up_at?: string | null;
          status?: Database["public"]["Enums"]["delivery_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deliveries_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deliveries_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      drivers: {
        Row: {
          address: string | null;
          commission_rate: number;
          created_at: string;
          current_lat: number | null;
          current_lng: number | null;
          first_name: string | null;
          id: string;
          id_doc_url: string | null;
          last_name: string | null;
          license_doc_url: string | null;
          license_plate: string | null;
          // Anticipates migration 20260712120000_add_driver_payout_account_names.sql
          // (not yet applied) — re-run `supabase gen types` after applying it.
          moncash_account_name: string | null;
          moncash_number: string | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          payout_frequency: string;
          phone: string | null;
          status: Database["public"]["Enums"]["driver_status"];
          updated_at: string;
          user_id: string;
          vehicle_photo_url: string | null;
          vehicle_type: string | null;
        };
        Insert: {
          address?: string | null;
          commission_rate?: number;
          created_at?: string;
          current_lat?: number | null;
          current_lng?: number | null;
          first_name?: string | null;
          id?: string;
          id_doc_url?: string | null;
          last_name?: string | null;
          license_doc_url?: string | null;
          license_plate?: string | null;
          moncash_account_name?: string | null;
          moncash_number?: string | null;
          natcash_account_name?: string | null;
          natcash_number?: string | null;
          payout_frequency?: string;
          phone?: string | null;
          status?: Database["public"]["Enums"]["driver_status"];
          updated_at?: string;
          user_id: string;
          vehicle_photo_url?: string | null;
          vehicle_type?: string | null;
        };
        Update: {
          address?: string | null;
          commission_rate?: number;
          created_at?: string;
          current_lat?: number | null;
          current_lng?: number | null;
          first_name?: string | null;
          id?: string;
          id_doc_url?: string | null;
          last_name?: string | null;
          license_doc_url?: string | null;
          license_plate?: string | null;
          moncash_account_name?: string | null;
          moncash_number?: string | null;
          natcash_account_name?: string | null;
          natcash_number?: string | null;
          payout_frequency?: string;
          phone?: string | null;
          status?: Database["public"]["Enums"]["driver_status"];
          updated_at?: string;
          user_id?: string;
          vehicle_photo_url?: string | null;
          vehicle_type?: string | null;
        };
        Relationships: [];
      };
      favorites: {
        Row: {
          created_at: string;
          id: string;
          restaurant_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          restaurant_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          restaurant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "favorites_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      menu_categories: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          restaurant_id: string;
          sort_order: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          restaurant_id: string;
          sort_order?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          restaurant_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      newsletter_subscribers: {
        Row: {
          email: string;
          id: string;
          source: string;
          subscribed_at: string;
          unsubscribed_at: string | null;
        };
        Insert: {
          email: string;
          id?: string;
          source?: string;
          subscribed_at?: string;
          unsubscribed_at?: string | null;
        };
        Update: {
          email?: string;
          id?: string;
          source?: string;
          subscribed_at?: string;
          unsubscribed_at?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          data: Json;
          id: string;
          read_at: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          data?: Json;
          id?: string;
          read_at?: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          data?: Json;
          id?: string;
          read_at?: string | null;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          created_at: string;
          id: string;
          line_total: number;
          notes: string | null;
          order_id: string;
          product_id: string | null;
          product_name: string;
          quantity: number;
          unit_price: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          line_total: number;
          notes?: string | null;
          order_id: string;
          product_id?: string | null;
          product_name: string;
          quantity: number;
          unit_price: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          line_total?: number;
          notes?: string | null;
          order_id?: string;
          product_id?: string | null;
          product_name?: string;
          quantity?: number;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          address_id: string | null;
          contact_phone: string | null;
          created_at: string;
          currency: string;
          customer_id: string;
          delivery_address: string;
          delivery_fee: number;
          delivery_lat: number | null;
          delivery_lng: number | null;
          delivery_notes: string | null;
          id: string;
          order_number: string;
          restaurant_id: string;
          service_fee: number;
          status: Database["public"]["Enums"]["order_status"];
          status_history: Json;
          subtotal: number;
          total: number;
          updated_at: string;
        };
        Insert: {
          address_id?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          currency?: string;
          customer_id: string;
          delivery_address: string;
          delivery_fee?: number;
          delivery_lat?: number | null;
          delivery_lng?: number | null;
          delivery_notes?: string | null;
          id?: string;
          order_number?: string;
          restaurant_id: string;
          service_fee?: number;
          status?: Database["public"]["Enums"]["order_status"];
          status_history?: Json;
          subtotal?: number;
          total?: number;
          updated_at?: string;
        };
        Update: {
          address_id?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          currency?: string;
          customer_id?: string;
          delivery_address?: string;
          delivery_fee?: number;
          delivery_lat?: number | null;
          delivery_lng?: number | null;
          delivery_notes?: string | null;
          id?: string;
          order_number?: string;
          restaurant_id?: string;
          service_fee?: number;
          status?: Database["public"]["Enums"]["order_status"];
          status_history?: Json;
          subtotal?: number;
          total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey";
            columns: ["address_id"];
            isOneToOne: false;
            referencedRelation: "addresses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_proofs: {
        Row: {
          created_at: string;
          file_url: string;
          id: string;
          notes: string | null;
          payment_id: string;
          sender_phone: string | null;
          transaction_ref: string | null;
          uploaded_by: string;
        };
        Insert: {
          created_at?: string;
          file_url: string;
          id?: string;
          notes?: string | null;
          payment_id: string;
          sender_phone?: string | null;
          transaction_ref?: string | null;
          uploaded_by: string;
        };
        Update: {
          created_at?: string;
          file_url?: string;
          id?: string;
          notes?: string | null;
          payment_id?: string;
          sender_phone?: string | null;
          transaction_ref?: string | null;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_proofs_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          created_at: string;
          currency: string;
          id: string;
          method: Database["public"]["Enums"]["payment_method"];
          order_id: string;
          receiver_account_name: string | null;
          receiver_number: string | null;
          receiver_restaurant_id: string | null;
          receiver_type: string;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sender_name: string | null;
          sender_phone: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          stripe_payment_intent_id: string | null;
          stripe_session_id: string | null;
          transaction_ref: string | null;
          updated_at: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          currency?: string;
          id?: string;
          method: Database["public"]["Enums"]["payment_method"];
          order_id: string;
          receiver_account_name?: string | null;
          receiver_number?: string | null;
          receiver_restaurant_id?: string | null;
          receiver_type?: string;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sender_name?: string | null;
          sender_phone?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          stripe_payment_intent_id?: string | null;
          stripe_session_id?: string | null;
          transaction_ref?: string | null;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          currency?: string;
          id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          order_id?: string;
          receiver_account_name?: string | null;
          receiver_number?: string | null;
          receiver_restaurant_id?: string | null;
          receiver_type?: string;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sender_name?: string | null;
          sender_phone?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          stripe_payment_intent_id?: string | null;
          stripe_session_id?: string | null;
          transaction_ref?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_receiver_restaurant_id_fkey";
            columns: ["receiver_restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_payout_settings: {
        Row: {
          id: boolean;
          moncash_account_name: string | null;
          moncash_number: string | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          moncash_account_name?: string | null;
          moncash_number?: string | null;
          natcash_account_name?: string | null;
          natcash_number?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          moncash_account_name?: string | null;
          moncash_number?: string | null;
          natcash_account_name?: string | null;
          natcash_number?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          archived_at: string | null;
          available: boolean;
          category_id: string | null;
          created_at: string;
          description: string | null;
          dish_type: string | null;
          id: string;
          image_url: string | null;
          name: string;
          popular: boolean;
          price: number;
          restaurant_id: string;
          sort_order: number;
          stock_quantity: number | null;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          available?: boolean;
          category_id?: string | null;
          created_at?: string;
          description?: string | null;
          dish_type?: string | null;
          id?: string;
          image_url?: string | null;
          name: string;
          popular?: boolean;
          price: number;
          restaurant_id: string;
          sort_order?: number;
          stock_quantity?: number | null;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          available?: boolean;
          category_id?: string | null;
          created_at?: string;
          description?: string | null;
          dish_type?: string | null;
          id?: string;
          image_url?: string | null;
          name?: string;
          popular?: boolean;
          price?: number;
          restaurant_id?: string;
          sort_order?: number;
          stock_quantity?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "menu_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          address: string | null;
          avatar_url: string | null;
          created_at: string;
          first_name: string | null;
          id: string;
          last_name: string | null;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          first_name?: string | null;
          id: string;
          last_name?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      promotions: {
        Row: {
          active: boolean;
          code: string | null;
          created_at: string;
          description: string | null;
          discount_type: string;
          discount_value: number;
          ends_at: string | null;
          id: string;
          restaurant_id: string;
          starts_at: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          code?: string | null;
          created_at?: string;
          description?: string | null;
          discount_type: string;
          discount_value: number;
          ends_at?: string | null;
          id?: string;
          restaurant_id: string;
          starts_at?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          code?: string | null;
          created_at?: string;
          description?: string | null;
          discount_type?: string;
          discount_value?: number;
          ends_at?: string | null;
          id?: string;
          restaurant_id?: string;
          starts_at?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "promotions_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_used_at: string;
          p256dh: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_used_at?: string;
          p256dh: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_used_at?: string;
          p256dh?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      restaurant_employees: {
        Row: {
          created_at: string;
          id: string;
          restaurant_id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          restaurant_id: string;
          role?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          restaurant_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "restaurant_employees_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      restaurant_payout_details: {
        Row: {
          commission_rate: number | null;
          commission_type: string | null;
          created_at: string;
          moncash_account_name: string | null;
          moncash_number: string | null;
          monthly_commission_amount: number | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          payout_mode: string;
          restaurant_id: string;
          updated_at: string;
        };
        Insert: {
          commission_rate?: number | null;
          commission_type?: string | null;
          created_at?: string;
          moncash_account_name?: string | null;
          moncash_number?: string | null;
          monthly_commission_amount?: number | null;
          natcash_account_name?: string | null;
          natcash_number?: string | null;
          payout_mode?: string;
          restaurant_id: string;
          updated_at?: string;
        };
        Update: {
          commission_rate?: number | null;
          commission_type?: string | null;
          created_at?: string;
          moncash_account_name?: string | null;
          moncash_number?: string | null;
          monthly_commission_amount?: number | null;
          natcash_account_name?: string | null;
          natcash_number?: string | null;
          payout_mode?: string;
          restaurant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "restaurant_payout_details_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: true;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      restaurants: {
        Row: {
          address: string | null;
          avg_prep_time: number;
          cover_url: string | null;
          created_at: string;
          cuisine: string | null;
          delivery_fee: number;
          description: string | null;
          id: string;
          lat: number | null;
          latitude: number | null;
          lng: number | null;
          logo_url: string | null;
          longitude: number | null;
          min_order: number;
          name: string;
          opening_hours: Json | null;
          owner_id: string | null;
          phone: string | null;
          rating: number | null;
          slug: string;
          status: Database["public"]["Enums"]["restaurant_status"];
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          avg_prep_time?: number;
          cover_url?: string | null;
          created_at?: string;
          cuisine?: string | null;
          delivery_fee?: number;
          description?: string | null;
          id?: string;
          lat?: number | null;
          latitude?: number | null;
          lng?: number | null;
          logo_url?: string | null;
          longitude?: number | null;
          min_order?: number;
          name: string;
          opening_hours?: Json | null;
          owner_id?: string | null;
          phone?: string | null;
          rating?: number | null;
          slug: string;
          status?: Database["public"]["Enums"]["restaurant_status"];
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          avg_prep_time?: number;
          cover_url?: string | null;
          created_at?: string;
          cuisine?: string | null;
          delivery_fee?: number;
          description?: string | null;
          id?: string;
          lat?: number | null;
          latitude?: number | null;
          lng?: number | null;
          logo_url?: string | null;
          longitude?: number | null;
          min_order?: number;
          name?: string;
          opening_hours?: Json | null;
          owner_id?: string | null;
          phone?: string | null;
          rating?: number | null;
          slug?: string;
          status?: Database["public"]["Enums"]["restaurant_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          comment: string | null;
          created_at: string;
          customer_id: string;
          driver_id: string | null;
          driver_rating: number | null;
          id: string;
          order_id: string;
          restaurant_id: string | null;
          restaurant_rating: number | null;
        };
        Insert: {
          comment?: string | null;
          created_at?: string;
          customer_id: string;
          driver_id?: string | null;
          driver_rating?: number | null;
          id?: string;
          order_id: string;
          restaurant_id?: string | null;
          restaurant_rating?: number | null;
        };
        Update: {
          comment?: string | null;
          created_at?: string;
          customer_id?: string;
          driver_id?: string | null;
          driver_rating?: number | null;
          id?: string;
          order_id?: string;
          restaurant_id?: string | null;
          restaurant_rating?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "drivers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_restaurant_employee_secure: {
        Args: { _email: string; _restaurant_id: string };
        Returns: {
          created_at: string;
          id: string;
          restaurant_id: string;
          role: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurant_employees";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      add_user_role_secure: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: undefined;
      };
      check_rate_limit_secure: {
        Args: {
          _action: string;
          _actor_override?: string | null;
          _max_hits: number;
          _window_seconds: number;
        };
        Returns: boolean;
      };
      claim_delivery_secure: {
        Args: { _order_id: string };
        Returns: {
          assigned_at: string;
          created_at: string;
          delivered_at: string | null;
          driver_heading: number | null;
          driver_id: string | null;
          driver_lat: number | null;
          driver_lng: number | null;
          driver_notes: string | null;
          fee: number;
          id: string;
          location_updated_at: string | null;
          order_id: string;
          picked_up_at: string | null;
          status: Database["public"]["Enums"]["delivery_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "deliveries";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_menu_category_secure: {
        Args: { _name: string; _restaurant_id: string; _sort_order?: number };
        Returns: {
          created_at: string;
          id: string;
          name: string;
          restaurant_id: string;
          sort_order: number;
        };
        SetofOptions: {
          from: "*";
          to: "menu_categories";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_order_secure: {
        Args: {
          _contact_phone: string;
          _delivery_address: string;
          _delivery_notes: string;
          _items: Json;
          _method: Database["public"]["Enums"]["payment_method"];
          _restaurant_id: string;
        };
        Returns: string;
      };
      create_product_secure: {
        Args: {
          _category_id: string;
          _description: string;
          _dish_type: string;
          _image_url: string;
          _name: string;
          _price: number;
          _restaurant_id: string;
          _stock_quantity?: number;
        };
        Returns: {
          archived_at: string | null;
          available: boolean;
          category_id: string | null;
          created_at: string;
          description: string | null;
          dish_type: string | null;
          id: string;
          image_url: string | null;
          name: string;
          popular: boolean;
          price: number;
          restaurant_id: string;
          sort_order: number;
          stock_quantity: number | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "products";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_promotion_secure: {
        Args: {
          _code: string;
          _description: string;
          _discount_type: string;
          _discount_value: number;
          _ends_at: string;
          _restaurant_id: string;
          _starts_at: string;
          _title: string;
        };
        Returns: {
          active: boolean;
          code: string | null;
          created_at: string;
          description: string | null;
          discount_type: string;
          discount_value: number;
          ends_at: string | null;
          id: string;
          restaurant_id: string;
          starts_at: string | null;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "promotions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      delete_menu_category_secure: {
        Args: { _category_id: string };
        Returns: undefined;
      };
      delete_product_secure: {
        Args: { _product_id: string };
        Returns: undefined;
      };
      delete_promotion_secure: {
        Args: { _promotion_id: string };
        Returns: undefined;
      };
      get_all_users_admin: {
        Args: { _search?: string };
        Returns: {
          banned_until: string;
          created_at: string;
          email: string;
          first_name: string;
          id: string;
          last_name: string;
          phone: string;
          roles: string[];
        }[];
      };
      get_customers_admin: {
        Args: { _search?: string };
        Returns: {
          address: string;
          created_at: string;
          email: string;
          first_name: string;
          id: string;
          last_name: string;
          phone: string;
          total_orders: number;
          total_spent: number;
        }[];
      };
      get_driver_earnings_summary: {
        Args: { _driver_id: string; _from: string; _to: string };
        Returns: {
          total_deliveries: number;
          total_earnings: number;
          week_earnings: number;
          week_start: string;
        }[];
      };
      get_platform_payout_public: {
        Args: never;
        Returns: {
          moncash_account_name: string;
          moncash_number: string;
          natcash_account_name: string;
          natcash_number: string;
        }[];
      };
      get_primary_role: { Args: { _user_id: string }; Returns: string };
      get_restaurant_payout_public: {
        Args: { _restaurant_id: string };
        Returns: {
          moncash_account_name: string;
          moncash_number: string;
          natcash_account_name: string;
          natcash_number: string;
          payout_mode: string;
          restaurant_id: string;
        }[];
      };
      get_restaurant_revenue_summary: {
        Args: { _from: string; _restaurant_id: string; _to: string };
        Returns: {
          cancelled_orders: number;
          commission_amount: number;
          commission_rate: number;
          delivered_orders: number;
          gross_revenue: number;
          net_payout: number;
          paid_amount: number;
          pending_amount: number;
          total_orders: number;
        }[];
      };
      get_restaurants_admin: {
        Args: never;
        Returns: {
          commission_rate: number;
          commission_type: string;
          created_at: string;
          cuisine: string;
          id: string;
          monthly_commission_amount: number;
          name: string;
          status: Database["public"]["Enums"]["restaurant_status"];
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      list_restaurant_employees_secure: {
        Args: { _restaurant_id: string };
        Returns: {
          created_at: string;
          email: string;
          first_name: string;
          id: string;
          last_name: string;
          user_id: string;
        }[];
      };
      remove_restaurant_employee_secure: {
        Args: { _id: string };
        Returns: undefined;
      };
      remove_user_role_secure: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: undefined;
      };
      submit_payment_proof_secure: {
        Args: {
          _file_url: string;
          _notes: string;
          _payment_id: string;
          _sender_phone: string;
          _transaction_ref: string;
        };
        Returns: {
          amount: number;
          created_at: string;
          currency: string;
          id: string;
          method: Database["public"]["Enums"]["payment_method"];
          order_id: string;
          receiver_account_name: string | null;
          receiver_number: string | null;
          receiver_restaurant_id: string | null;
          receiver_type: string;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sender_name: string | null;
          sender_phone: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          stripe_payment_intent_id: string | null;
          stripe_session_id: string | null;
          transaction_ref: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "payments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_driver_payout_secure: {
        Args: {
          _driver_id: string;
          _moncash_account_name: string;
          _moncash_number: string;
          _natcash_account_name: string;
          _natcash_number: string;
          _payout_frequency: string;
        };
        Returns: {
          address: string | null;
          commission_rate: number;
          created_at: string;
          current_lat: number | null;
          current_lng: number | null;
          first_name: string | null;
          id: string;
          id_doc_url: string | null;
          last_name: string | null;
          license_doc_url: string | null;
          license_plate: string | null;
          moncash_account_name: string | null;
          moncash_number: string | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          payout_frequency: string;
          phone: string | null;
          status: Database["public"]["Enums"]["driver_status"];
          updated_at: string;
          user_id: string;
          vehicle_photo_url: string | null;
          vehicle_type: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "drivers";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_driver_status_secure: {
        Args: {
          _driver_id: string;
          _status: Database["public"]["Enums"]["driver_status"];
        };
        Returns: {
          address: string | null;
          commission_rate: number;
          created_at: string;
          current_lat: number | null;
          current_lng: number | null;
          first_name: string | null;
          id: string;
          id_doc_url: string | null;
          last_name: string | null;
          license_doc_url: string | null;
          license_plate: string | null;
          moncash_account_name: string | null;
          moncash_number: string | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          payout_frequency: string;
          phone: string | null;
          status: Database["public"]["Enums"]["driver_status"];
          updated_at: string;
          user_id: string;
          vehicle_photo_url: string | null;
          vehicle_type: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "drivers";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_menu_category_secure: {
        Args: { _category_id: string; _name: string; _sort_order: number };
        Returns: {
          created_at: string;
          id: string;
          name: string;
          restaurant_id: string;
          sort_order: number;
        };
        SetofOptions: {
          from: "*";
          to: "menu_categories";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_order_status_secure: {
        Args: {
          _new_status: Database["public"]["Enums"]["order_status"];
          _order_id: string;
        };
        Returns: {
          address_id: string | null;
          contact_phone: string | null;
          created_at: string;
          currency: string;
          customer_id: string;
          delivery_address: string;
          delivery_fee: number;
          delivery_lat: number | null;
          delivery_lng: number | null;
          delivery_notes: string | null;
          id: string;
          order_number: string;
          restaurant_id: string;
          service_fee: number;
          status: Database["public"]["Enums"]["order_status"];
          status_history: Json;
          subtotal: number;
          total: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "orders";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_platform_payout_settings_secure: {
        Args: {
          _moncash_account_name: string;
          _moncash_number: string;
          _natcash_account_name: string;
          _natcash_number: string;
        };
        Returns: undefined;
      };
      update_product_secure: {
        Args: {
          _available: boolean;
          _category_id: string;
          _description: string;
          _dish_type: string;
          _image_url: string;
          _name: string;
          _price: number;
          _product_id: string;
          _stock_quantity?: number;
        };
        Returns: {
          archived_at: string | null;
          available: boolean;
          category_id: string | null;
          created_at: string;
          description: string | null;
          dish_type: string | null;
          id: string;
          image_url: string | null;
          name: string;
          popular: boolean;
          price: number;
          restaurant_id: string;
          sort_order: number;
          stock_quantity: number | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "products";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_promotion_secure: {
        Args: {
          _active: boolean;
          _code: string;
          _description: string;
          _discount_type: string;
          _discount_value: number;
          _ends_at: string;
          _promotion_id: string;
          _starts_at: string;
          _title: string;
        };
        Returns: {
          active: boolean;
          code: string | null;
          created_at: string;
          description: string | null;
          discount_type: string;
          discount_value: number;
          ends_at: string | null;
          id: string;
          restaurant_id: string;
          starts_at: string | null;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "promotions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_restaurant_commission_secure: {
        Args: {
          _commission_rate: number;
          _commission_type: string;
          _monthly_commission_amount: number;
          _restaurant_id: string;
        };
        Returns: {
          commission_rate: number | null;
          commission_type: string | null;
          created_at: string;
          moncash_account_name: string | null;
          moncash_number: string | null;
          monthly_commission_amount: number | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          payout_mode: string;
          restaurant_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurant_payout_details";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_restaurant_hours_secure: {
        Args: { _opening_hours: Json; _restaurant_id: string };
        Returns: {
          address: string | null;
          avg_prep_time: number;
          cover_url: string | null;
          created_at: string;
          cuisine: string | null;
          delivery_fee: number;
          description: string | null;
          id: string;
          lat: number | null;
          latitude: number | null;
          lng: number | null;
          logo_url: string | null;
          longitude: number | null;
          min_order: number;
          name: string;
          opening_hours: Json | null;
          owner_id: string | null;
          phone: string | null;
          rating: number | null;
          slug: string;
          status: Database["public"]["Enums"]["restaurant_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurants";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_restaurant_payout_secure: {
        Args: {
          _moncash_account_name: string;
          _moncash_number: string;
          _natcash_account_name: string;
          _natcash_number: string;
          _payout_mode: string;
          _restaurant_id: string;
        };
        Returns: {
          commission_rate: number | null;
          commission_type: string | null;
          created_at: string;
          moncash_account_name: string | null;
          moncash_number: string | null;
          monthly_commission_amount: number | null;
          natcash_account_name: string | null;
          natcash_number: string | null;
          payout_mode: string;
          restaurant_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurant_payout_details";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_restaurant_profile_secure: {
        Args: {
          _address: string;
          _cover_url: string;
          _cuisine: string;
          _description: string;
          _logo_url: string;
          _name: string;
          _phone: string;
          _restaurant_id: string;
        };
        Returns: {
          address: string | null;
          avg_prep_time: number;
          cover_url: string | null;
          created_at: string;
          cuisine: string | null;
          delivery_fee: number;
          description: string | null;
          id: string;
          lat: number | null;
          latitude: number | null;
          lng: number | null;
          logo_url: string | null;
          longitude: number | null;
          min_order: number;
          name: string;
          opening_hours: Json | null;
          owner_id: string | null;
          phone: string | null;
          rating: number | null;
          slug: string;
          status: Database["public"]["Enums"]["restaurant_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurants";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_restaurant_status_secure: {
        Args: {
          _restaurant_id: string;
          _status: Database["public"]["Enums"]["restaurant_status"];
        };
        Returns: {
          address: string | null;
          avg_prep_time: number;
          cover_url: string | null;
          created_at: string;
          cuisine: string | null;
          delivery_fee: number;
          description: string | null;
          id: string;
          lat: number | null;
          latitude: number | null;
          lng: number | null;
          logo_url: string | null;
          longitude: number | null;
          min_order: number;
          name: string;
          opening_hours: Json | null;
          owner_id: string | null;
          phone: string | null;
          rating: number | null;
          slug: string;
          status: Database["public"]["Enums"]["restaurant_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "restaurants";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      app_role:
        "customer" | "restaurant_owner" | "restaurant_staff" | "driver" | "admin" | "super_admin";
      delivery_status:
        | "assigned"
        | "en_route_pickup"
        | "picked_up"
        | "en_route_dropoff"
        | "delivered"
        | "cancelled";
      driver_status: "pending" | "approved" | "suspended" | "rejected" | "offline" | "online";
      order_status:
        | "pending"
        | "confirmed"
        | "preparing"
        | "ready"
        | "assigned"
        | "picked_up"
        | "delivered"
        | "cancelled"
        | "refunded";
      payment_method: "stripe" | "moncash" | "natcash" | "kach";
      payment_status:
        "pending" | "awaiting_proof" | "under_review" | "paid" | "failed" | "refunded";
      restaurant_status: "pending" | "approved" | "suspended" | "rejected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
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
      driver_status: ["pending", "approved", "suspended", "rejected", "offline", "online"],
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
      payment_status: ["pending", "awaiting_proof", "under_review", "paid", "failed", "refunded"],
      restaurant_status: ["pending", "approved", "suspended", "rejected"],
    },
  },
} as const;
