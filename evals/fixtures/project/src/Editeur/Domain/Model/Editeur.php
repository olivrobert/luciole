<?php

declare(strict_types=1);

namespace Editeur\Domain\Model;

use Common\Domain\Model\IdentityTrait;
use Common\Domain\Model\SoftDeleteableTrait;
use Common\Domain\Model\Telephone;
use Common\Domain\Model\TimestampableTrait;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Editeur\Domain\Enum\FormatPublication;
use Editeur\Domain\Enum\StatutCompte;
use Editeur\Domain\Enum\TailleCatalogue;
use Editeur\Domain\Exception\FicheIncompleteException;
use Editeur\Domain\Model\Embeddable\Adresse;
use Editeur\Domain\Model\Embeddable\Diffuseur;
use Fonds\Domain\Model\Genre;
use Fonds\Domain\Model\Ouvrage;
use Gedmo\Mapping\Annotation as Gedmo;
use Identite\Domain\Model\Administrateur;
use SharedKernel\Domain\Model\Langue;
use SharedKernel\Domain\Model\Pays;
use SharedKernel\Domain\Model\Region;

#[ORM\Entity]
#[ORM\Table(name: 'editeur')]
#[ORM\UniqueConstraint(name: 'uniq_editeur_siret', columns: ['siret'])]
#[Gedmo\SoftDeleteable(fieldName: 'deletedAt', timeAware: false, hardDelete: false)]
class Editeur implements \Stringable
{
    use IdentityTrait;
    use SoftDeleteableTrait;
    use TimestampableTrait;

    public const int LONGUEUR_SIRET = 14;

    /** @var list<FormatPublication> */
    public const FORMATS_NUMERIQUES = [
        FormatPublication::Epub,
        FormatPublication::Pdf,
        FormatPublication::LivreAudio,
    ];

    #[ORM\Column(length: 20, enumType: StatutCompte::class)]
    public private(set) StatutCompte $statutCompte;

    #[ORM\Column(nullable: true)]
    public private(set) ?\DateTimeImmutable $dateTraitement = null;

    #[ORM\ManyToOne(targetEntity: Administrateur::class)]
    #[ORM\JoinColumn(nullable: true)]
    public private(set) ?Administrateur $traitePar = null;

    #[ORM\Column(length: 255)]
    public private(set) string $raisonSociale;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $nomCommercial = null;

    #[ORM\Column(length: 14)]
    public private(set) string $siret;

    #[ORM\Column(length: 50, nullable: true)]
    public private(set) ?string $numeroTva = null;

    #[ORM\Column(length: 20, nullable: true)]
    public private(set) ?string $prefixeIsbn = null;

    #[ORM\Embedded(class: Adresse::class, columnPrefix: 'siege_')]
    public private(set) Adresse $adresseSiege;

    #[ORM\Embedded(class: Adresse::class, columnPrefix: 'facturation_')]
    public private(set) Adresse $adresseFacturation;

    #[ORM\ManyToOne(targetEntity: Pays::class)]
    #[ORM\JoinColumn(nullable: false)]
    public private(set) Pays $pays;

    #[ORM\ManyToOne(inversedBy: 'editeurs', targetEntity: Region::class)]
    #[ORM\JoinColumn(nullable: true)]
    public private(set) ?Region $region = null;

    #[ORM\Column(type: 'telephone', length: 20)]
    public private(set) Telephone $telephone;

    #[ORM\Column(length: 255)]
    public private(set) string $emailContact;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $siteInternet = null;

    #[ORM\Embedded(class: Diffuseur::class, columnPrefix: 'diffuseur_')]
    public private(set) Diffuseur $diffuseur;

    #[ORM\Column(enumType: TailleCatalogue::class)]
    public private(set) TailleCatalogue $tailleCatalogue;

    #[ORM\Column(nullable: true)]
    public private(set) ?int $anneeCreation = null;

    #[ORM\Column]
    public private(set) bool $publieJeunesse = false;

    #[ORM\Column]
    public private(set) bool $publieNumerique = false;

    #[ORM\Column]
    public private(set) bool $accepteDepotLegalNumerique = false;

    /** @var FormatPublication[] */
    #[ORM\Column(enumType: FormatPublication::class)]
    public private(set) array $formats = [];

    #[ORM\Column(type: 'text', nullable: true)]
    public private(set) ?string $presentation = null;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $logoChemin = null;

    #[ORM\Column(type: 'text', nullable: true)]
    public private(set) ?string $commentaireRefus = null;

    /** @var Collection<int, Genre> */
    #[ORM\ManyToMany(targetEntity: Genre::class)]
    #[ORM\JoinTable(name: 'editeur_genre')]
    public private(set) Collection $genres;

    /** @var Collection<int, Langue> */
    #[ORM\ManyToMany(targetEntity: Langue::class)]
    #[ORM\JoinTable(name: 'editeur_langue')]
    public private(set) Collection $langues;

    /** @var Collection<int, Ouvrage> */
    #[ORM\OneToMany(targetEntity: Ouvrage::class, mappedBy: 'editeur')]
    public private(set) Collection $ouvrages;

    /** @var Collection<int, Correspondant> */
    #[ORM\OneToMany(targetEntity: Correspondant::class, mappedBy: 'editeur', cascade: ['persist'], orphanRemoval: true)]
    public private(set) Collection $correspondants;

    public function __construct(
        string $raisonSociale,
        string $siret,
        Adresse $adresseSiege,
        Pays $pays,
        string $telephone,
        string $emailContact,
        TailleCatalogue $tailleCatalogue,
    ) {
        $this->raisonSociale = $raisonSociale;
        $this->siret = $siret;
        $this->adresseSiege = $adresseSiege;
        $this->adresseFacturation = $adresseSiege;
        $this->pays = $pays;
        $this->telephone = Telephone::fromString($telephone);
        $this->emailContact = $emailContact;
        $this->tailleCatalogue = $tailleCatalogue;
        $this->diffuseur = Diffuseur::aucun();
        $this->statutCompte = StatutCompte::EnAttente;
        $this->genres = new ArrayCollection();
        $this->langues = new ArrayCollection();
        $this->ouvrages = new ArrayCollection();
        $this->correspondants = new ArrayCollection();
    }

    private function isFicheComplete(): bool
    {
        return null !== $this->presentation
            && !$this->genres->isEmpty()
            && !$this->langues->isEmpty()
            && !$this->correspondants->isEmpty();
    }

    public function valider(Administrateur $administrateur): void
    {
        if (StatutCompte::EnAttente !== $this->statutCompte) {
            throw new \LogicException('Seul un éditeur en attente peut être validé.');
        }

        if (!$this->isFicheComplete()) {
            throw new FicheIncompleteException($this->siret);
        }

        $this->statutCompte = StatutCompte::Valide;
        $this->dateTraitement = new \DateTimeImmutable();
        $this->traitePar = $administrateur;
        $this->commentaireRefus = null;
    }

    public function refuser(?Administrateur $administrateur = null, ?string $commentaire = null): void
    {
        if (StatutCompte::EnAttente !== $this->statutCompte) {
            throw new \LogicException('Seul un éditeur en attente peut être refusé.');
        }

        $this->statutCompte = StatutCompte::Refuse;
        $this->dateTraitement = new \DateTimeImmutable();
        $this->traitePar = $administrateur;
        $this->commentaireRefus = $commentaire;
    }

    public function desactiver(): void
    {
        if (StatutCompte::Valide !== $this->statutCompte) {
            throw new \LogicException('Seul un éditeur validé peut être désactivé.');
        }

        $this->statutCompte = StatutCompte::Desactive;
    }

    public function reactiver(): void
    {
        if (StatutCompte::Desactive !== $this->statutCompte) {
            throw new \LogicException('Seul un éditeur désactivé peut être réactivé.');
        }

        $this->statutCompte = StatutCompte::Valide;
    }

    public function resoumettre(): void
    {
        if (StatutCompte::Refuse !== $this->statutCompte) {
            throw new \LogicException('Seul un éditeur refusé peut soumettre à nouveau sa fiche.');
        }

        $this->statutCompte = StatutCompte::EnAttente;
        $this->dateTraitement = null;
        $this->traitePar = null;
    }

    public function isEnAttente(): bool
    {
        return StatutCompte::EnAttente === $this->statutCompte;
    }

    public function isValide(): bool
    {
        return StatutCompte::Valide === $this->statutCompte;
    }

    public function isDesactive(): bool
    {
        return StatutCompte::Desactive === $this->statutCompte;
    }

    public function updateIdentite(string $raisonSociale, ?string $nomCommercial, ?string $numeroTva, ?string $prefixeIsbn): void
    {
        $this->raisonSociale = $raisonSociale;
        $this->nomCommercial = $nomCommercial;
        $this->numeroTva = $numeroTva;
        $this->prefixeIsbn = $prefixeIsbn;
    }

    public function updateAdresses(Adresse $siege, ?Adresse $facturation, Pays $pays, ?Region $region): void
    {
        $this->adresseSiege = $siege;
        $this->adresseFacturation = $facturation ?? $siege;
        $this->pays = $pays;
        $this->region = $region;
    }

    public function updateContact(string $telephone, string $emailContact, ?string $siteInternet): void
    {
        $this->telephone = Telephone::fromString($telephone);
        $this->emailContact = $emailContact;
        $this->siteInternet = $siteInternet;
    }

    public function updateDiffuseur(Diffuseur $diffuseur): void
    {
        $this->diffuseur = $diffuseur;
    }

    /**
     * @param list<FormatPublication> $formats
     */
    public function updateProfilEditorial(
        TailleCatalogue $tailleCatalogue,
        ?int $anneeCreation,
        bool $publieJeunesse,
        array $formats,
        ?string $presentation,
    ): void {
        $this->tailleCatalogue = $tailleCatalogue;
        $this->anneeCreation = $anneeCreation;
        $this->publieJeunesse = $publieJeunesse;
        $this->formats = $formats;
        $this->publieNumerique = [] !== array_intersect(
            array_map(static fn (FormatPublication $f): string => $f->value, $formats),
            array_map(static fn (FormatPublication $f): string => $f->value, self::FORMATS_NUMERIQUES),
        );
        $this->presentation = $presentation;
    }

    public function accepterDepotLegalNumerique(): void
    {
        if (!$this->publieNumerique) {
            throw new \LogicException('Le dépôt légal numérique suppose un catalogue numérique.');
        }

        $this->accepteDepotLegalNumerique = true;
    }

    public function retirerDepotLegalNumerique(): void
    {
        $this->accepteDepotLegalNumerique = false;
    }

    /**
     * @param list<Genre> $genres
     */
    public function updateGenres(array $genres): void
    {
        $this->genres->clear();
        foreach ($genres as $genre) {
            $this->genres->add($genre);
        }
    }

    /**
     * @param list<Langue> $langues
     */
    public function updateLangues(array $langues): void
    {
        $this->langues->clear();
        foreach ($langues as $langue) {
            $this->langues->add($langue);
        }
    }

    public function ajouterCorrespondant(Correspondant $correspondant): void
    {
        if (!$this->correspondants->contains($correspondant)) {
            $this->correspondants->add($correspondant);
        }
    }

    public function retirerCorrespondant(Correspondant $correspondant): void
    {
        $this->correspondants->removeElement($correspondant);
    }

    public function correspondantPrincipal(): ?Correspondant
    {
        foreach ($this->correspondants as $correspondant) {
            if ($correspondant->isPrincipal) {
                return $correspondant;
            }
        }

        return null;
    }

    public function changerLogo(?string $chemin): void
    {
        $this->logoChemin = $chemin;
    }

    public function countOuvragesPublies(): int
    {
        return $this->ouvrages->filter(static fn (Ouvrage $o): bool => $o->isPublie())->count();
    }

    public function isPetitEditeur(): bool
    {
        return TailleCatalogue::MoinsDeCent === $this->tailleCatalogue;
    }

    public function libelleTaille(): string
    {
        return match ($this->tailleCatalogue) {
            TailleCatalogue::MoinsDeCent => 'Moins de 100 titres',
            TailleCatalogue::CentAMille => 'De 100 à 1 000 titres',
            TailleCatalogue::PlusDeMille => 'Plus de 1 000 titres',
        };
    }

    public function siretFormate(): string
    {
        return implode(' ', [
            substr($this->siret, 0, 3),
            substr($this->siret, 3, 3),
            substr($this->siret, 6, 3),
            substr($this->siret, 9, 5),
        ]);
    }

    public function nomAffiche(): string
    {
        return $this->nomCommercial ?? $this->raisonSociale;
    }

    public function anciennete(\DateTimeImmutable $aujourdhui = new \DateTimeImmutable()): ?int
    {
        if (null === $this->anneeCreation) {
            return null;
        }

        return (int) $aujourdhui->format('Y') - $this->anneeCreation;
    }

    public function hasPrefixeIsbn(): bool
    {
        return null !== $this->prefixeIsbn && '' !== $this->prefixeIsbn;
    }

    public function couvreLangue(Langue $langue): bool
    {
        return $this->langues->contains($langue);
    }

    public function couvreGenre(Genre $genre): bool
    {
        return $this->genres->contains($genre);
    }

    #[\Override]
    public function __toString(): string
    {
        return \sprintf('%s (%s)', $this->nomAffiche(), $this->siretFormate());
    }
}
