import type { Lang } from "../i18n/utils";

export interface FounderBioPhoto {
  src: string;
  alt: string;
  caption: string;
  wide?: boolean;
}

export interface FounderBio {
  name: string;
  paragraphs: string[];
  photos: FounderBioPhoto[];
  quote: string;
  quoteAttribution: string;
}

export const founderBio: Partial<Record<Lang, FounderBio>> = {
  fr: {
    name: "Deo-Gratias KPODO alias « Monsieur Weblack »",
    paragraphs: [
      "Entrepreneur, stratège en communication et directeur artistique, Deo-Gratias KPODO est le fondateur et directeur créatif de WEBLACK, agence internationale de conseil en stratégie de marque, communication, direction créative et production d’événements. Depuis plus de quinze ans, il accompagne maisons de mode, institutions, organisations internationales et talents dans leur stratégie de marque, leur image et leur rayonnement international — du branding à la direction artistique, en passant par le management de talents, les relations presse et la production d’expériences premium.",
      "Il joue un rôle stratégique auprès de la Maison de Couture « Marie Kaba », dont il accompagne le positionnement haut de gamme et l’expansion internationale, et intervient sur plusieurs événements dédiés aux savoir-faire africains : Le FIMO228 (Togo), La Nuit du Textile Africain (Mali), Du Rêve à la Réalité (Côte d’Ivoire), Les Awards du Mannequin africain (Côte d’Ivoire), Le Carrousel international de la Mode (Rép. du Congo), Folies de Mode (Burkina Faso), ZE DEFILE (France) et African Fashion Show (Danemark).",
      "Visionnaire et bâtisseur d’écosystèmes, il œuvre à la professionnalisation des industries créatives africaines, inspiré par les standards des grandes maisons de luxe, avec l’ambition de faire de WEBLACK une référence internationale au service de la créativité.",
    ],
    photos: [
      {
        src: "/photos/founder-portrait-bw.jpg",
        alt: "Portrait de Deo-Gratias Kpodo, fondateur et directeur créatif de WEBLACK.",
        caption: "Deo-Gratias Kpodo, fondateur & directeur créatif de WEBLACK",
      },
      {
        src: "/photos/founder-portrait-profile.jpg",
        alt: "Deo-Gratias Kpodo en représentation lors d’un événement.",
        caption: "Deo-Gratias Kpodo en représentation",
      },
      {
        src: "/photos/founder-ze-defile-stage.jpg",
        alt: "Deo-Gratias Kpodo sur scène lors de ZÉ DÉFILÉ by WAXFASHION, à Paris.",
        caption: "ZÉ DÉFILÉ by WAXFASHION, Paris",
        wide: true,
      },
    ],
    quote:
      "Les plus grandes réussites ne naissent pas uniquement du talent, mais d’une vision capable d’inspirer, de rassembler et de construire dans la durée. Mon ambition est de créer des opportunités qui permettront aux talents africains de s’exprimer, d’innover et de rayonner avec l’excellence qu’ils méritent sur la scène internationale.",
    quoteAttribution: "Deo-Gratias KPODO",
  },
  en: {
    name: "Deo-Gratias KPODO — known as “Monsieur Weblack”",
    paragraphs: [
      "Entrepreneur, communications strategist and creative director, Deo-Gratias KPODO is the founder and creative director of WEBLACK, an international agency specialising in brand strategy, communications, creative direction and event production. For more than fifteen years, he has guided fashion houses, institutions, international organisations and talents in their brand strategy, image and international outreach — from branding to creative direction, talent management, press relations and premium experience design.",
      "He plays a strategic role with the Maison de Couture “Marie Kaba”, supporting its premium positioning and international expansion, and is involved in several events dedicated to African craftsmanship: Le FIMO228 (Togo), La Nuit du Textile Africain (Mali), Du Rêve à la Réalité (Côte d'Ivoire), Les Awards du Mannequin africain (Côte d'Ivoire), Le Carrousel international de la Mode (Republic of Congo), Folies de Mode (Burkina Faso), ZE DEFILE (France) and African Fashion Show (Denmark).",
      "A visionary and ecosystem builder, he works toward the professionalisation of African creative industries, inspired by the standards of the great luxury houses, with the ambition of making WEBLACK an international reference in service of creativity.",
    ],
    photos: [
      {
        src: "/photos/founder-portrait-bw.jpg",
        alt: "Portrait of Deo-Gratias Kpodo, founder and creative director of WEBLACK.",
        caption: "Deo-Gratias Kpodo, founder & creative director of WEBLACK",
      },
      {
        src: "/photos/founder-portrait-profile.jpg",
        alt: "Deo-Gratias Kpodo speaking at an event.",
        caption: "Deo-Gratias Kpodo on stage",
      },
      {
        src: "/photos/founder-ze-defile-stage.jpg",
        alt: "Deo-Gratias Kpodo on stage at ZÉ DÉFILÉ by WAXFASHION, in Paris.",
        caption: "ZÉ DÉFILÉ by WAXFASHION, Paris",
        wide: true,
      },
    ],
    quote:
      "The greatest achievements are not born of talent alone, but of a vision capable of inspiring, uniting and building for the long term. My ambition is to create opportunities that allow African talents to express themselves, innovate and shine with the excellence they deserve on the international stage.",
    quoteAttribution: "Deo-Gratias KPODO",
  },
};
