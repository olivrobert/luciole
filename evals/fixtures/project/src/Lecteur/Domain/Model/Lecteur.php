<?php

declare(strict_types=1);

namespace Lecteur\Domain\Model;

use Common\Domain\Model\IdentityTrait;
use Common\Domain\Model\Telephone;
use Common\Domain\Model\TimestampableTrait;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Fonds\Domain\Model\Genre;
use Identite\Domain\Model\Utilisateur;
use Lecteur\Domain\Enum\CategorieLecteur;
use Lecteur\Domain\Enum\CanalContact;
use Lecteur\Domain\Enum\StatutAbonnement;
use Lecteur\Domain\Exception\ProfilIncompletException;
use Lecteur\Domain\Model\Embeddable\Adresse;
use Mediatheque\Domain\Model\Mediatheque;
use SharedKernel\Domain\Model\Langue;
use SharedKernel\Domain\Model\Pays;

#[ORM\Entity]
#[ORM\Table(name: 'lecteur')]
class Lecteur implements \Stringable
{
    use IdentityTrait;
    use TimestampableTrait;

    public const int AGE_MAJORITE = 18;

    public const int DUREE_ABONNEMENT_MOIS = 12;

    /** @var list<CategorieLecteur> */
    public const CATEGORIES_GRATUITES = [
        CategorieLecteur::Enfant,
        CategorieLecteur::Etudiant,
        CategorieLecteur::DemandeurEmploi,
    ];

    #[ORM\OneToOne(targetEntity: Utilisateur::class, mappedBy: 'lecteur', fetch: 'EAGER')]
    public private(set) ?Utilisateur $utilisateur = null;

    #[ORM\ManyToOne(targetEntity: Mediatheque::class)]
    #[ORM\JoinColumn(nullable: false)]
    public private(set) Mediatheque $mediathequeRattachement;

    #[ORM\Column(length: 20, enumType: StatutAbonnement::class)]
    public private(set) StatutAbonnement $statutAbonnement;

    #[ORM\Column(length: 20, enumType: CategorieLecteur::class)]
    public private(set) CategorieLecteur $categorie;

    #[ORM\Column(length: 32, unique: true)]
    public private(set) string $numeroCarte;

    #[ORM\Column(length: 255)]
    public private(set) string $nom;

    #[ORM\Column(length: 255)]
    public private(set) string $prenom;

    #[ORM\Column(type: 'date_immutable')]
    public private(set) \DateTimeImmutable $dateNaissance;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $email = null;

    #[ORM\Column(type: 'telephone', length: 20)]
    public private(set) Telephone $telephonePortable;

    #[ORM\Column(type: 'telephone', length: 20, nullable: true)]
    public private(set) ?Telephone $telephoneFixe = null;

    #[ORM\Embedded(class: Adresse::class, columnPrefix: 'adresse_')]
    public private(set) Adresse $adresse;

    #[ORM\ManyToOne(targetEntity: Pays::class)]
    #[ORM\JoinColumn(nullable: true)]
    public private(set) ?Pays $paysNaissance = null;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $nomResponsableLegal = null;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $prenomResponsableLegal = null;

    #[ORM\Column(length: 20, nullable: true)]
    public private(set) ?string $telephoneResponsableLegal = null;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $emailResponsableLegal = null;

    #[ORM\Column(enumType: CanalContact::class)]
    public private(set) CanalContact $canalContactPrefere;

    #[ORM\Column]
    public private(set) bool $accepteNewsletter = false;

    #[ORM\Column]
    public private(set) bool $accepteRappelsSms = false;

    #[ORM\Column]
    public private(set) bool $accesNumerique = false;

    #[ORM\Column(nullable: true)]
    public private(set) ?\DateTimeImmutable $dateDebutAbonnement = null;

    #[ORM\Column(nullable: true)]
    public private(set) ?\DateTimeImmutable $dateFinAbonnement = null;

    #[ORM\Column(nullable: true)]
    public private(set) ?\DateTimeImmutable $dateSuspension = null;

    #[ORM\Column(length: 255, nullable: true)]
    public private(set) ?string $motifSuspension = null;

    #[ORM\Column]
    public private(set) int $nombreRetards = 0;

    #[ORM\Column]
    public private(set) int $montantPenalitesCentimes = 0;

    #[ORM\Column(nullable: true)]
    public private(set) ?\DateTimeImmutable $dernierPassage = null;

    /** @var Collection<int, Langue> */
    #[ORM\ManyToMany(targetEntity: Langue::class)]
    #[ORM\JoinTable(name: 'lecteur_langue')]
    public private(set) Collection $languesLecture;

    /** @var Collection<int, Genre> */
    #[ORM\ManyToMany(targetEntity: Genre::class)]
    #[ORM\JoinTable(name: 'lecteur_genre_prefere')]
    public private(set) Collection $genresPreferes;

    /** @var Collection<int, Pret> */
    #[ORM\OneToMany(targetEntity: Pret::class, mappedBy: 'lecteur')]
    public private(set) Collection $prets;

    /** @var Collection<int, Reservation> */
    #[ORM\OneToMany(targetEntity: Reservation::class, mappedBy: 'lecteur', orphanRemoval: true)]
    public private(set) Collection $reservations;

    public function __construct(
        Mediatheque $mediathequeRattachement,
        string $numeroCarte,
        string $nom,
        string $prenom,
        \DateTimeImmutable $dateNaissance,
        string $telephonePortable,
        Adresse $adresse,
        CategorieLecteur $categorie,
    ) {
        $this->mediathequeRattachement = $mediathequeRattachement;
        $this->numeroCarte = $numeroCarte;
        $this->nom = $nom;
        $this->prenom = $prenom;
        $this->dateNaissance = $dateNaissance;
        $this->telephonePortable = Telephone::fromString($telephonePortable);
        $this->adresse = $adresse;
        $this->categorie = $categorie;
        $this->statutAbonnement = StatutAbonnement::EnAttente;
        $this->canalContactPrefere = CanalContact::Email;
        $this->languesLecture = new ArrayCollection();
        $this->genresPreferes = new ArrayCollection();
        $this->prets = new ArrayCollection();
        $this->reservations = new ArrayCollection();
    }

    public function isMineur(\DateTimeImmutable $aujourdhui = new \DateTimeImmutable()): bool
    {
        return $this->dateNaissance->diff($aujourdhui)->y < self::AGE_MAJORITE;
    }

    public function isGratuit(): bool
    {
        return \in_array($this->categorie, self::CATEGORIES_GRATUITES, true);
    }

    public function renseignerResponsableLegal(string $nom, string $prenom, string $telephone, ?string $email): void
    {
        $this->nomResponsableLegal = $nom;
        $this->prenomResponsableLegal = $prenom;
        $this->telephoneResponsableLegal = $telephone;
        $this->emailResponsableLegal = $email;
    }

    private function isProfilComplet(): bool
    {
        if ($this->isMineur() && null === $this->nomResponsableLegal) {
            return false;
        }

        return null !== $this->email || CanalContact::Courrier === $this->canalContactPrefere;
    }

    public function activer(\DateTimeImmutable $debut): void
    {
        if (StatutAbonnement::EnAttente !== $this->statutAbonnement) {
            throw new \LogicException('Seul un abonnement en attente peut être activé.');
        }

        if (!$this->isProfilComplet()) {
            throw new ProfilIncompletException($this->numeroCarte);
        }

        $this->statutAbonnement = StatutAbonnement::Actif;
        $this->dateDebutAbonnement = $debut;
        $this->dateFinAbonnement = $debut->modify(\sprintf('+%d months', self::DUREE_ABONNEMENT_MOIS));
    }

    public function renouveler(): void
    {
        if (!\in_array($this->statutAbonnement, [StatutAbonnement::Actif, StatutAbonnement::Expire], true)) {
            throw new \LogicException('Seul un abonnement actif ou expiré peut être renouvelé.');
        }

        $depart = $this->dateFinAbonnement > new \DateTimeImmutable() ? $this->dateFinAbonnement : new \DateTimeImmutable();
        \assert(null !== $depart);

        $this->statutAbonnement = StatutAbonnement::Actif;
        $this->dateFinAbonnement = $depart->modify(\sprintf('+%d months', self::DUREE_ABONNEMENT_MOIS));
    }

    public function expirer(\DateTimeImmutable $aujourdhui): void
    {
        if (StatutAbonnement::Actif !== $this->statutAbonnement) {
            throw new \LogicException('Seul un abonnement actif peut expirer.');
        }

        if (null === $this->dateFinAbonnement || $this->dateFinAbonnement > $aujourdhui) {
            throw new \LogicException('L\'abonnement court encore.');
        }

        $this->statutAbonnement = StatutAbonnement::Expire;
    }

    public function isAbonnementActif(): bool
    {
        return StatutAbonnement::Actif === $this->statutAbonnement;
    }

    public function isSuspendu(): bool
    {
        return StatutAbonnement::Suspendu === $this->statutAbonnement;
    }

    public function peutEmprunter(): bool
    {
        return $this->isAbonnementActif() && 0 === $this->montantPenalitesCentimes;
    }

    public function enregistrerPassage(\DateTimeImmutable $quand): void
    {
        $this->dernierPassage = $quand;
    }

    public function enregistrerRetard(int $penaliteCentimes): void
    {
        ++$this->nombreRetards;
        $this->montantPenalitesCentimes += $penaliteCentimes;
    }

    public function reglerPenalites(int $montantCentimes): void
    {
        if ($montantCentimes > $this->montantPenalitesCentimes) {
            throw new \InvalidArgumentException('Le règlement dépasse le montant dû.');
        }

        $this->montantPenalitesCentimes -= $montantCentimes;
    }

    public function hasPretsEnCours(): bool
    {
        foreach ($this->prets as $pret) {
            if ($pret->isEnCours()) {
                return true;
            }
        }

        return false;
    }

    public function countPretsEnCours(): int
    {
        return $this->prets->filter(static fn (Pret $pret): bool => $pret->isEnCours())->count();
    }

    public function ajouterReservation(Reservation $reservation): void
    {
        if (!$this->reservations->contains($reservation)) {
            $this->reservations->add($reservation);
        }
    }

    public function annulerReservation(Reservation $reservation): void
    {
        $this->reservations->removeElement($reservation);
    }

    /**
     * @param list<Langue> $langues
     */
    public function updateLanguesLecture(array $langues): void
    {
        $this->languesLecture->clear();
        foreach ($langues as $langue) {
            $this->languesLecture->add($langue);
        }
    }

    /**
     * @param list<Genre> $genres
     */
    public function updateGenresPreferes(array $genres): void
    {
        $this->genresPreferes->clear();
        foreach ($genres as $genre) {
            $this->genresPreferes->add($genre);
        }
    }

    public function updatePreferencesContact(CanalContact $canal, bool $newsletter, bool $rappelsSms): void
    {
        $this->canalContactPrefere = $canal;
        $this->accepteNewsletter = $newsletter;
        $this->accepteRappelsSms = $rappelsSms;
    }

    public function updateCoordonnees(
        ?string $email,
        string $telephonePortable,
        ?string $telephoneFixe,
        Adresse $adresse,
    ): void {
        $this->email = $email;
        $this->telephonePortable = Telephone::fromString($telephonePortable);
        $this->telephoneFixe = null !== $telephoneFixe ? Telephone::fromString($telephoneFixe) : null;
        $this->adresse = $adresse;
    }

    public function changerCategorie(CategorieLecteur $categorie): void
    {
        $this->categorie = $categorie;
    }

    public function transfererVers(Mediatheque $mediatheque): void
    {
        if ($this->hasPretsEnCours()) {
            throw new \LogicException('Un lecteur avec des prêts en cours ne peut pas changer de médiathèque.');
        }

        $this->mediathequeRattachement = $mediatheque;
    }

    public function ouvrirAccesNumerique(): void
    {
        if (!$this->isAbonnementActif()) {
            throw new \LogicException('L\'accès numérique demande un abonnement actif.');
        }

        $this->accesNumerique = true;
    }

    public function fermerAccesNumerique(): void
    {
        $this->accesNumerique = false;
    }

    public function suspendre(string $motif, \DateTimeImmutable $quand): void
    {
        $this->statutAbonnement = StatutAbonnement::Suspendu;
        $this->motifSuspension = $motif;
        $this->dateSuspension = $quand;
        $this->accesNumerique = false;
    }

    public function lever(): void
    {
        if (StatutAbonnement::Suspendu !== $this->statutAbonnement) {
            throw new \LogicException('Seul un abonnement suspendu peut être rétabli.');
        }

        $this->statutAbonnement = StatutAbonnement::Actif;
        $this->motifSuspension = null;
        $this->dateSuspension = null;
    }

    public function resilier(): void
    {
        if (StatutAbonnement::Resilie === $this->statutAbonnement) {
            throw new \LogicException('Cet abonnement est déjà résilié.');
        }

        if ($this->hasPretsEnCours()) {
            throw new \LogicException('Un abonnement avec des prêts en cours ne peut pas être résilié.');
        }

        $this->statutAbonnement = StatutAbonnement::Resilie;
        $this->accesNumerique = false;
        $this->reservations->clear();
    }

    public function archiver(): void
    {
        if (StatutAbonnement::Resilie !== $this->statutAbonnement) {
            throw new \LogicException('Seul un abonnement résilié peut être archivé.');
        }

        $this->statutAbonnement = StatutAbonnement::Archive;
        $this->email = null;
        $this->telephoneFixe = null;
        $this->accepteNewsletter = false;
        $this->accepteRappelsSms = false;
    }

    public function joursAvantExpiration(\DateTimeImmutable $aujourdhui): ?int
    {
        if (null === $this->dateFinAbonnement) {
            return null;
        }

        $jours = (int) $aujourdhui->diff($this->dateFinAbonnement)->format('%r%a');

        return max(0, $jours);
    }

    public function libelleCategorie(): string
    {
        return match ($this->categorie) {
            CategorieLecteur::Enfant => 'Enfant',
            CategorieLecteur::Etudiant => 'Étudiant',
            CategorieLecteur::DemandeurEmploi => 'Demandeur d\'emploi',
            CategorieLecteur::Adulte => 'Adulte',
            CategorieLecteur::Senior => 'Senior',
            CategorieLecteur::Collectivite => 'Collectivité',
        };
    }

    public function initiales(): string
    {
        return mb_strtoupper(mb_substr($this->prenom, 0, 1).mb_substr($this->nom, 0, 1));
    }

    public function nomComplet(): string
    {
        return $this->prenom.' '.$this->nom;
    }

    public function setUtilisateur(?Utilisateur $utilisateur): void
    {
        $this->utilisateur = $utilisateur;
    }

    #[\Override]
    public function __toString(): string
    {
        return \sprintf('%s (%s)', $this->nomComplet(), $this->numeroCarte);
    }
}
