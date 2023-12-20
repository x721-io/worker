export interface Trait {
  display_type?: string;
  trait_type: string;
  value: string;
}

export interface Metadata {
  id: string;
  name: string;
  image: string;
  external_url: string;
  description: string;
  animation_url: string;
  attributes: Trait[];
}
